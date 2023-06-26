import { AttributeType } from './node_modules/@aws-sdk/client-cognito-identity-provider/dist-types/models/models_0.d';
import {
  CognitoIdentityProvider,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { Department, RelevantCognitoData, UserServiceData } from './types';
import { COGNITO_POOL_ID } from './secrets';
import {
  cognitoClient,
  pgApplicantApplyClient,
  pgUserServiceClient,
} from './clients';
import { createHash, randomUUID } from 'crypto';

const main = async () => {
  await pgApplicantApplyClient.connect();
  await pgUserServiceClient.connect();

  const { rows: pgUsersFromApply } = await pgApplicantApplyClient.query(
    'SELECT * FROM gap_user'
  );
  const { Users } = (await cognitoClient.listUsers({
    UserPoolId: COGNITO_POOL_ID,
  })) as {
    Users: UserType[];
  };

  const cognitoUsers = Users.map(getRelevantCognitoAttributes).filter(
    Boolean
  ) as RelevantCognitoData[];

  await populateDepartmentsTable(cognitoUsers);

  (
    cognitoUsers.map((users) =>
      addDataFromApply(pgUsersFromApply, users)
    ) as UserServiceData[]
  ).map(addDataToUserService);
  return 1;
};

const populateDepartmentsTable = async (
  cognitoUsers: RelevantCognitoData[]
) => {
  const depts = cognitoUsers.reduce((acc, { dept }) => {
    if (!acc.includes(dept)) acc.push(dept);
    return acc;
  }, [] as string[]);

  const { rows: existingDepartments }: { rows: Department[] } =
    await pgUserServiceClient.query(`SELECT * from departments`);

  depts.filter(Boolean).forEach(async (dept) => {
    const departmentExists = existingDepartments.some(
      ({ name }) => name === dept
    );
    if (!departmentExists) {
      await pgUserServiceClient.query(
        `INSERT INTO departments (id, name, ggis_id) VALUES ($1, $2, $3)`,
        [randomUUID(), dept, '']
      );
    }
  });
};

const getRelevantCognitoAttributes = ({
  Attributes,
  Username: emailAddress,
}: UserType) => {
  const invalidUser = !emailAddress || !Attributes;
  if (invalidUser) return null;

  const featuresIndex = Attributes.findIndex(
    ({ Name, Value }: AttributeType) => Value && Name === 'custom:features'
  );
  if (featuresIndex < 0) return null;

  const formattedFeatureData = Attributes[featuresIndex]
    .Value!.split(',')
    .map((feature) => feature.split('=')) as [string, string][];
  const { dept, roles } = formattedFeatureData.reduce(getRoleAndDept, {
    dept: '',
    roles: [],
  });
  const { sub } = pickAttributes(Attributes, ['sub']);
  const hashedEmailAddress = createHash('sha512')
    .update(emailAddress)
    .digest('base64');
  return {
    hashedEmailAddress,
    dept,
    roles,
    sub,
  };
};

const pickAttributes = (attributes: AttributeType[], selection: string[]) =>
  selection.reduce((acc, val) => {
    const index = attributes.findIndex(
      ({ Name }: { Name: string | undefined }) => Name === val
    );
    if (index < 0) return acc;
    acc[val.replace(':', '')] = attributes[index].Value;
    return acc;
  }, {} as { [key: string]: string | undefined });

const getRoleAndDept = (
  acc: { dept: string; roles: string[] },
  { 0: name, 1: val }: [string, string]
) => {
  if (name === 'dept') acc.dept = val;
  if (name === 'user') acc.roles.push(val);
  return acc;
};

const addDataFromApply = (
  usersFromApply: { gap_user_id: string; user_sub: string }[],
  cognitoUser: RelevantCognitoData
) => {
  const { gap_user_id } =
    usersFromApply.find(({ user_sub }) => user_sub === cognitoUser.sub) || {};

  if (!gap_user_id)
    console.log('cannot find gap_user_id for user with sub: ', cognitoUser.sub);

  return { ...cognitoUser, gap_user_id };
};

export const addDataToUserService = async ({
  sub,
  dept,
  hashedEmailAddress,
  gap_user_id,
  roles,
}: UserServiceData) => {
  const { id: deptId } = ((
    await pgUserServiceClient.query(
      `SELECT * FROM departments WHERE name = $1`,
      [dept]
    )
  ).rows[0] || {}) as Department;

  const userExists = await pgUserServiceClient.query(
    'SELECT * from gap_users where sub = $1',
    [sub]
  );
  if (userExists.rows.length > 0) return;

  return pgUserServiceClient.query(
    `INSERT INTO gap_users (email, sub, dept_id, gap_user_id, roles) VALUES ($1, $2, $3, $4, $5)`,
    [hashedEmailAddress, sub, deptId, gap_user_id, roles ? roles.join('#') : '']
  );
};

main();
