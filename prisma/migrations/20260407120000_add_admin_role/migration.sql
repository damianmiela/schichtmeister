-- Add ADMIN value to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN';
