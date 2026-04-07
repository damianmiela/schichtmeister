-- Add ADMIN value to UserRole enum
ALTER TYPE "UserRole" ADD VALUE 'ADMIN';

-- Upgrade initial admin account
UPDATE "User" SET role = 'ADMIN' WHERE email = 'damian.miela@gmail.com';
