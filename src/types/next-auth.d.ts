import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
      facilityId: string;
      employeeId: string | null;
    };
  }

  interface User {
    role: UserRole;
    facilityId: string;
    employeeId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: UserRole;
    facilityId: string;
    employeeId: string | null;
  }
}
