import {
  AttributeType,
} from './node_modules/@aws-sdk/client-cognito-identity-provider/dist-types/models/models_0.d';
import {
  CognitoIdentityProvider,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { RelevantCognitoData } from './types';
import { COGNITO_ACCESS_KEY, COGNITO_POOL_ID, COGNITO_SECRET } from './secrets';

const cognitoClient = new CognitoIdentityProvider({
  credentials: {
    secretAccessKey: COGNITO_SECRET,
    accessKeyId: COGNITO_ACCESS_KEY,
  },
});

const main = async () => {
  const { Users } = (await cognitoClient.listUsers({
    UserPoolId: COGNITO_POOL_ID,
  })) as {
    Users: UserType[];
  };
  (
    Users.map(getRelevantAttributes).filter(Boolean) as RelevantCognitoData[]
  ).map(addUserDataToPostgres);
  // Users.forEach(user => {
  //   console.log({ user })
  //   console.log({ attributes: user.Attributes })
  // });
};

const getRelevantAttributes = ({
  Attributes,
  Username: emailAddress,
}: UserType) => {
  const invalidUser = !emailAddress || !Attributes;
  if (invalidUser) return null;

  const formatIndex = Attributes.findIndex(
    ({ Name, Value }: AttributeType) => Value && Name === 'custom:features'
  );
  if (formatIndex < 0) return null;

  const { dept, roles } = (
    Attributes[formatIndex]
      .Value!.split(',')
      .map((feature) => feature.split('=')) as [string, string][]
  ).reduce(getRoleAndDept, {
    dept: '',
    roles: [],
  });
  return { emailAddress, dept, roles };
};

const getRoleAndDept = (
  acc: { dept: string; roles: string[] },
  { 0: name, 1: val }: [string, string]
) => {
  if (name === 'dept') acc.dept = val;
  if (name === 'user') acc.roles.push(val);
  return acc;
};

const addUserDataToPostgres = async ({
  dept,
  roles,
  emailAddress,
}: RelevantCognitoData) => {
  console.log({ dept, roles, emailAddress });
  //
};

main();
