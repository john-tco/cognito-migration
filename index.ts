import { AttributeType } from './node_modules/@aws-sdk/client-cognito-identity-provider/dist-types/models/models_0.d';
import { UserType } from '@aws-sdk/client-cognito-identity-provider';
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

const DRY_RUN = false;

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
};

const ROLE_MAP = {
  ordinary_user: ['APPLICANT', 'FIND'],
  'ordinary_user\t': ['APPLICANT', 'FIND'],
  administrator: ['ADMIN'],
};

const populateDeptAndRoleTable = async (
  cognitoUsers: RelevantCognitoData[]
) => {
  const { depts, roles } = cognitoUsers.reduce(
    (acc, { dept, roles }) => {
      if (!acc.depts.includes(dept)) acc.depts.push(dept);
      roles.forEach((role) => {
        const mappedRoles = ROLE_MAP[
          role as keyof typeof ROLE_MAP
        ] || [role];
        mappedRoles.forEach(
          (role) => !acc.roles.includes(role) && acc.roles.push(role)
        );
      });
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
      if (DRY_RUN) {
        console.log('INSERT INTO roles (id, name) VALUES ($1, $2)');
        console.log([randomUUID(), role]);
      } else {
        await pgUserServiceClient.query(
          `INSERT INTO roles (id, name) VALUES ($1, $2)`,
          [randomUUID(), role]
        );
      }
    }
  });
  depts.filter(Boolean).forEach(async (dept) => {
    const departmentExists = existingDepartments.some(
      ({ name }) => name === dept
    );
    if (!departmentExists) {
      if (DRY_RUN) {
        console.log(
          `INSERT INTO departments (id, name, ggis_id) VALUES ($1, $2, $3)`,
          console.log([randomUUID(), dept, ''])
        );
      } else {
        await pgUserServiceClient.query(
          `INSERT INTO departments (id, name, ggis_id) VALUES ($1, $2, $3)`,
          [randomUUID(), dept, '']
        );
      }
    }
  });
};

const getRelevantCognitoAttributes = async ({
  Attributes,
  Username: email,
}: UserType) => {
  const invalidUser = !email || !Attributes;
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
  return {
    email,
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

  return {
    ...cognitoUser,
    gap_user_id,
    roles: cognitoUser.roles
      .map((role) => ROLE_MAP[role as keyof typeof ROLE_MAP] || [role])
      .flat(),
  };
};


// @TODO: this will only work with a fresh database, for envs other than local we 
// will need a better strategy
let userId = 0;

export const addDataToUserService = async ({
  sub,
  dept,
  email,
  roles,
}: UserServiceData) => {
  const gap_user_id = userId++;

  const userExists = await pgUserServiceClient.query(
    'SELECT * from gap_users where sub = $1',
    [sub]
  );
  if (userExists.rows.length > 0) return;

  const { id: deptId } = ((
    await pgUserServiceClient.query(
      `SELECT * FROM departments WHERE name = $1`,
      [dept]
    )
  ).rows[0] || {}) as Department;

  if (DRY_RUN) {
    console.log(
      `INSERT INTO gap_users (gap_user_id, email, sub, dept_id) VALUES ($1, $2, $3, $4)`,
      console.log([
        gap_user_id,
        email,
        sub,
        deptId
      ])
    );
  } else {
    await pgUserServiceClient.query(
      `INSERT INTO gap_users (gap_user_id, email, sub, dept_id) VALUES ($1, $2, $3, $4)`,
      [gap_user_id, email, sub, deptId]
    );
  }

  await Promise.all(roles.map(async (role) => {
    const { id: roleId } = ((
      await pgUserServiceClient.query(`SELECT * FROM roles WHERE name = $1`, [
        role,
      ])
    ).rows[0] || {}) as Role;

    if (DRY_RUN) {
      console.log(
        'will insert INTO roles_users (roles_id, users_gap_user_id) VALUES ($1, $2)'
      );
      console.log([roleId, gap_user_id]);
    } else {
      await pgUserServiceClient.query(
        `INSERT INTO roles_users (roles_id, users_gap_user_id) VALUES ($1, $2)`,
        [roleId, gap_user_id]
      );
    }
  }));
};

main();
