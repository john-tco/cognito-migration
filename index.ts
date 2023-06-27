import { AttributeType } from './node_modules/@aws-sdk/client-cognito-identity-provider/dist-types/models/models_0.d';
import {
  CognitoIdentityProvider,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  Department,
  RelevantCognitoData,
  Role,
  UserServiceData,
} from './types';
import { COGNITO_POOL_ID } from './secrets';
import {
  cognitoClient,
  pgApplicantApplyClient,
  pgUserServiceClient,
} from './clients';
import { createHash, randomUUID } from 'crypto';
import { encrypt } from './encryption';

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
  const cognitoUsers = (
    await Promise.all(Users.map(getRelevantCognitoAttributes))
  ).filter(Boolean) as RelevantCognitoData[];
  await populateDeptAndRoleTable(cognitoUsers);
  (
    cognitoUsers.map((users) =>
      addDataFromApply(pgUsersFromApply, users)
    ) as UserServiceData[]
  ).map(addDataToUserService);
  return 1;
};

const populateDeptAndRoleTable = async (
  cognitoUsers: RelevantCognitoData[]
) => {
  const { depts, roles } = cognitoUsers.reduce(
    (acc, { dept, roles }) => {
      if (!acc.depts.includes(dept)) acc.depts.push(dept);
      roles.forEach(
        (role) => !acc.roles.includes(role) && acc.roles.push(role)
      );
      return acc;
    },
    { roles: [], depts: [] } as { roles: string[]; depts: string[] }
  );
  const { rows: existingDepartments }: { rows: Department[] } =
    await pgUserServiceClient.query(`SELECT * from departments`);
  const { rows: existingRoles }: { rows: Role[] } =
    await pgUserServiceClient.query(`SELECT * from roles`);
  roles.filter(Boolean).forEach(async (role) => {
    const roleExists = existingRoles.some(({ name }) => name === role);
    if (!roleExists) {
      await pgUserServiceClient.query(
        `INSERT INTO roles (id, name) VALUES ($1, $2)`,
        [randomUUID(), role]
      );
    }
  });
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

const getRelevantCognitoAttributes = async ({
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
    encryptedEmailAddress: await encrypt(emailAddress),
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
  encryptedEmailAddress,
  gap_user_id,
  roles,
}: UserServiceData) => {
  const userExists = await pgUserServiceClient.query(
    'SELECT * from gap_users where sub = $1',
    [sub]
  );
  if (userExists.rows.length > 0) return;

  roles.forEach(async (role) => {
    const { id: roleId } = ((
      await pgUserServiceClient.query(`SELECT * FROM roles WHERE name = $1`, [
        role,
      ])
    ).rows[0] || {}) as Role;

    await pgUserServiceClient.query(
      `INSERT INTO user_roles (id, user_sub, role_id) VALUES ($1, $2, $3)`,
      [randomUUID(), sub, roleId]
    );
  });

  const { id: deptId } = ((
    await pgUserServiceClient.query(`SELECT * FROM departments WHERE name = $1`, [
      dept,
    ])
  ).rows[0] || {}) as Department;
  await pgUserServiceClient.query(
    `INSERT INTO gap_users (hashedEmail, encryptedEmail, sub, dept_id, gap_user_id) VALUES ($1, $2, $3, $4, $5)`,
    [
      hashedEmailAddress,
      encryptedEmailAddress,
      sub,
      deptId,
      gap_user_id,
    ]
  );
};

main();
