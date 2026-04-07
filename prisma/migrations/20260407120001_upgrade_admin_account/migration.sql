-- Upgrade initial admin account
UPDATE "User" SET role = 'ADMIN' WHERE email = 'damian.miela@gmail.com';
