import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { writeLog } from "@/lib/logging/serverLogger";
import type { AuthEvent } from "@/lib/logging/logTypes";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          writeLog("system", {
            ts: new Date().toISOString(),
            type: "login_failed",
            data: { email: email ?? "", reason: "Benutzer nicht gefunden" },
          } as AuthEvent);
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          writeLog("system", {
            ts: new Date().toISOString(),
            type: "login_failed",
            userId: user.id,
            userName: (user as Record<string, unknown>).name as string ?? "",
            data: { email, reason: "Falsches Passwort" },
          } as AuthEvent);
          return null;
        }

        writeLog("system", {
          ts: new Date().toISOString(),
          type: "login",
          userId: user.id,
          userName: (user as Record<string, unknown>).name as string ?? "",
          data: { email },
        } as AuthEvent);

        return {
          id: user.id,
          email: user.email,
          name: (user as Record<string, unknown>).name as string ?? "",
          role: user.role,
          facilityId: user.facilityId,
          employeeId: user.employeeId,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name ?? "";
        token.role = user.role;
        token.facilityId = user.facilityId;
        token.employeeId = user.employeeId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.name = token.name ?? "";
        session.user.role = token.role;
        session.user.facilityId = token.facilityId;
        session.user.employeeId = token.employeeId ?? null;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
