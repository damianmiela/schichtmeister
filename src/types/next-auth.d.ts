import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      name: string;
      role: UserRole;
      facilityId: string;
      employeeId: string | null;
    };
  }

  interface User {
    name: string;
    role: UserRole;
    facilityId: string;
    employeeId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    name: string;
    role: UserRole;
    facilityId: string;
    employeeId: string | null;
  }
}
