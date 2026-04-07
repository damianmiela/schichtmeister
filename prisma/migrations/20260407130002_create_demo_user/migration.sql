-- Create demo user (linked to first facility found)
INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "facilityId", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'demo',
  '$2b$10$ccqqqPrLGbiRjn3FE9optO39qVddD52/1ITe13iKsIzDM00QI72YW',
  'Demo Benutzer',
  'DEMO'::"UserRole",
  (SELECT id FROM "Facility" LIMIT 1),
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'demo');
