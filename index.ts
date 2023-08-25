import { AttributeType } from "./node_modules/@aws-sdk/client-cognito-identity-provider/dist-types/models/models_0.d";
import { UserType } from "@aws-sdk/client-cognito-identity-provider";
import {
  Department,
  RelevantCognitoData,
  Role,
  UserServiceData,
} from "./types";
import { COGNITO_POOL_ID, DRY_RUN } from "./secrets";
import { cognitoClient, pgUserServiceClient } from "./clients";

const main = async () => {
  await pgUserServiceClient.connect();

  let { Users: users, PaginationToken: paginationToken } =
    await cognitoClient.listUsers({
      UserPoolId: COGNITO_POOL_ID,
    });

  if (!users) throw new Error("No users found in Cognito");
  let processedUsers = users.length;

  await processUsers(users);

  console.log("Processed " + processedUsers + " users from Cognito");

  while (users && paginationToken) {
    const response = await cognitoClient.listUsers({
      UserPoolId: COGNITO_POOL_ID,
      PaginationToken: paginationToken,
    });

    if (!response.Users) throw new Error("No users found in Cognito");

    await processUsers(response.Users);
    paginationToken = response.PaginationToken;

    processedUsers += response.Users.length;
    console.log("Processed " + processedUsers + " users from Cognito");
  }

  console.log("Finished processing users from Cognito");
};

async function processUsers(users: UserType[]) {
  const cognitoUsers = (
    await Promise.all(users.map(getRelevantCognitoAttributes))
  ).filter(Boolean) as RelevantCognitoData[];

  await populateDeptTable(cognitoUsers);

  (
    cognitoUsers.map((users) => addDataFromApply(users)) as UserServiceData[]
  ).forEach(addDataToUserService);
}

const ROLE_MAP = {
  ordinary_user: ["APPLICANT", "FIND"],
  "ordinary_user\t": ["APPLICANT", "FIND"],
  administrator: ["ADMIN"],
};

const populateDeptTable = async (cognitoUsers: RelevantCognitoData[]) => {
  const { depts } = cognitoUsers.reduce(
    (acc, { dept }) => {
      if (!acc.depts.includes(dept)) acc.depts.push(dept);
      return acc;
    },
    { depts: [] } as { depts: string[] }
  );

  const { rows: existingDepartments }: { rows: Department[] } =
    await pgUserServiceClient.query(`SELECT * from departments`);

  depts.filter(Boolean).forEach(async (dept) => {
    const departmentExists = existingDepartments.some(
      ({ name }) => name === dept
    );
    if (!departmentExists) {
      if (DRY_RUN) {
        console.log(
          `INSERT INTO departments (name, ggis_id) VALUES ($1, $2)`,
          console.log([dept, ""])
        );
      } else {
        await pgUserServiceClient.query(
          `INSERT INTO departments (name, ggis_id) VALUES ($1, $2)`,
          [dept, ""]
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
    ({ Name, Value }: AttributeType) => Value && Name === "custom:features"
  );
  if (featuresIndex < 0) return null;

  const formattedFeatureData = Attributes[featuresIndex]
    .Value!.split(",")
    .map((feature) => feature.split("=")) as [string, string][];
  const { dept, roles } = formattedFeatureData.reduce(getRoleAndDept, {
    dept: "",
    roles: [],
  });

  const { sub } = pickAttributes(Attributes, ["sub"]);
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
    acc[val.replace(":", "")] = attributes[index].Value;
    return acc;
  }, {} as { [key: string]: string | undefined });

const getRoleAndDept = (
  acc: { dept: string; roles: string[] },
  { 0: name, 1: val }: [string, string]
) => {
  if (name === "dept") acc.dept = val;
  if (name === "user") acc.roles.push(val);
  return acc;
};

const addDataFromApply = (cognitoUser: RelevantCognitoData) => {
  return {
    ...cognitoUser,
    roles: cognitoUser.roles
      .map((role) => ROLE_MAP[role as keyof typeof ROLE_MAP] || [role])
      .flat(),
  };
};

export const addDataToUserService = async ({
  sub,
  dept,
  email,
  roles,
}: UserServiceData) => {
  const userExists = await pgUserServiceClient.query(
    "SELECT * from gap_users where sub = $1",
    [sub]
  );
  if (userExists.rows.length > 0) return;

  const { id: deptId } = ((
    await pgUserServiceClient.query(
      `SELECT * FROM departments WHERE name = $1`,
      [dept]
    )
  ).rows[0] || {}) as Department;

  let response = { rows: [{ gap_user_id: 1 }] };

  if (DRY_RUN) {
    console.log(
      `INSERT INTO gap_users (email, cola_sub, dept_id, login_journey_state) VALUES ($1, $2, $3, $4)`,
      console.log([email, sub, deptId, "PRIVACY_POLICY_PENDING"])
    );
  } else {
    response = await pgUserServiceClient.query(
      `INSERT INTO gap_users (email, cola_sub, dept_id, login_journey_state) VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, sub, deptId, "PRIVACY_POLICY_PENDING"]
    );
  }

  const { gap_user_id } = response.rows[0];

  if (gap_user_id) {
    if (email === "thomas.hezlett@cabinetoffice.gov.uk") {
      if (DRY_RUN) {
        console.log(
          "will insert INTO roles_users (roles_id, users_gap_user_id) VALUES ($1)",
          console.log([4, gap_user_id])
        );
      } else {
        await pgUserServiceClient.query(
          `INSERT INTO roles_users (roles_id, users_gap_user_id) VALUES ($1, $2)`,
          [4, gap_user_id]
        );
      }
    }

    await Promise.all(
      roles.map(async (role) => {
        const { id: roleId } = ((
          await pgUserServiceClient.query(
            `SELECT * FROM roles WHERE name = $1`,
            [role]
          )
        ).rows[0] || {}) as Role;

        if (DRY_RUN) {
          console.log(
            "will insert INTO roles_users (roles_id, users_gap_user_id) VALUES ($1)",
            console.log([roleId, gap_user_id])
          );
        } else {
          await pgUserServiceClient.query(
            `INSERT INTO roles_users (roles_id, users_gap_user_id) VALUES ($1, $2)`,
            [roleId, gap_user_id]
          );
        }
      })
    );
  }
};

main();
