import { AttributeType } from './node_modules/@aws-sdk/client-cognito-identity-provider/dist-types/models/models_0.d';
import {
  CognitoIdentityProvider,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { RelevantCognitoData, UserServiceData } from './types';
import { COGNITO_POOL_ID } from './secrets';
import {
  cognitoClient,
  pgApplicantApplyClient,
  pgUserServiceClient,
} from './clients';

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
  (
    (
      Users.map(getRelevantCognitoAttributes).filter(
        Boolean
      ) as RelevantCognitoData[]
    ).map((users) =>
      addDataFromApply(pgUsersFromApply, users)
    ) as UserServiceData[]
  ).map(addDataToUserService);
  return 1;
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

  const { dept, roles } = (
    Attributes[featuresIndex]
      .Value!.split(',')
      .map((feature) => feature.split('=')) as [string, string][]
  ).reduce(getRoleAndDept, {
    dept: '',
    roles: [],
  });
  const { sub, customphoneNumber } = pickAttributes(Attributes, [
    'sub',
    'custom:phoneNumber',
  ]);
  return { emailAddress, dept, roles, sub, phoneNumber: customphoneNumber };
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
  usersFromApply: { gap_user_id: number; user_sub: string }[],
  cognitoUser: RelevantCognitoData
) => {
  const { gap_user_id } =
    usersFromApply.find(({ user_sub }) => user_sub === cognitoUser.sub) || {};
  return { ...cognitoUser, gap_user_id };
};

export const addDataToUserService = async ({
  sub,
  dept,
  emailAddress,
  gap_user_id,
  phoneNumber,
  roles,
}: UserServiceData) =>
  pgUserServiceClient.query(
    `INSERT INTO gap_users (email, sub, dept, gap_user_id, phonenumber, roles) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      emailAddress || '',
      sub,
      dept,
      gap_user_id,
      phoneNumber,
      roles ? roles.join('#') : '',
    ]
  );

main();
