-- Turns the live SchichtMeister database into the public demo. Runs once, in one
-- transaction: any error rolls everything back.
--   * Employees get random German names. Contracts, hours, stations, qualifications,
--     absences and schedules stay as they are.
--   * Logins: the admin account named in keep_email stays, plus one demo login
--     (demo@schichtmeister.local / demo1234). Every other account is removed.
--   * Free-text notes, renamed version labels, the audit log, generation logs,
--     score reports and saved warnings are cleared, because they can contain names.
--     Warnings come back as soon as a month is opened.
--   * The facility gets a neutral name.
--
-- Take a dump first. Then, on the server:
--   cd /srv/schichtmeister && set -a && source .env && set +a
--   docker exec -i schichtmeister-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v keep_email='you@example.com' < deploy/demo-anonymize.sql

\set ON_ERROR_STOP on
SET client_encoding = 'UTF8';
BEGIN;

SELECT set_config('demo.keep_email', lower(:'keep_email'), true);

DO $anon$
DECLARE
  demo_email constant text := 'demo@schichtmeister.local';
  demo_hash constant text := '$2b$10$.pbQOLnrdkPpRNCVY5a.8ezI92HhA2jxv88KifT4vXhg3Vzrh4L9q'; -- bcrypt of "demo1234"
  keep_id text;
  demo_id text;
  old_id text;
BEGIN
  SELECT id INTO keep_id FROM "User" WHERE lower(email) = current_setting('demo.keep_email');
  IF keep_id IS NULL THEN
    RAISE EXCEPTION 'No account with email %, nothing was changed', current_setting('demo.keep_email');
  END IF;

  -- The old demo login was just "demo", which the login form's email field doesn't accept.
  UPDATE "User" SET email = demo_email WHERE email = 'demo';
  INSERT INTO "User" (id, email, "passwordHash", name, role, "facilityId", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, demo_email, demo_hash, 'Demo Benutzer', 'DEMO'::"UserRole", id, now(), now()
    FROM "Facility" ORDER BY "createdAt" LIMIT 1
  ON CONFLICT (email) DO NOTHING;
  UPDATE "User"
     SET "passwordHash" = demo_hash, name = 'Demo Benutzer', role = 'DEMO'::"UserRole",
         "employeeId" = NULL, "updatedAt" = now()
   WHERE email = demo_email
  RETURNING id INTO demo_id;
  IF demo_id IS NULL THEN
    RAISE EXCEPTION 'No facility found, nothing was changed';
  END IF;

  -- Remove every other account. Their assignments now count as made by the demo login,
  -- also inside saved versions, because restoring a version reads createdByUserId from there.
  DELETE FROM "AuditLog";
  DELETE FROM "PasswordResetToken";
  UPDATE "Assignment" SET "createdByUserId" = demo_id WHERE "createdByUserId" NOT IN (keep_id, demo_id);
  FOR old_id IN SELECT id FROM "User" WHERE id NOT IN (keep_id, demo_id) LOOP
    UPDATE "ScheduleVersion"
       SET "assignmentsJson" = replace("assignmentsJson",
             '"createdByUserId":"' || old_id || '"', '"createdByUserId":"' || demo_id || '"')
     WHERE strpos("assignmentsJson", old_id) > 0;
  END LOOP;
  DELETE FROM "User" WHERE id NOT IN (keep_id, demo_id); -- swap approvals fall back to NULL

  -- Random first names; last names are unique for up to 100 employees.
  WITH names AS (
    SELECT ARRAY['Anna','Lena','Laura','Julia','Sarah','Lisa','Katharina','Sophie','Marie','Hannah',
                 'Leonie','Johanna','Paula','Emma','Mia','Clara','Nina','Eva','Sabine','Petra',
                 'Monika','Andrea','Claudia','Susanne','Birgit','Heike','Karin','Ute','Martina','Nicole',
                 'Stefanie','Christina','Melanie','Jana','Franziska','Lukas','Jonas','Leon','Felix','Paul',
                 'Maximilian','Tim','Jan','Niklas','Tobias','Florian','Daniel','Sebastian','Michael','Thomas',
                 'Andreas','Stefan','Markus','Christian','Frank','Jürgen','Peter','Uwe','Matthias','Oliver'] AS first_names,
           ARRAY['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann',
                 'Schäfer','Koch','Bauer','Richter','Klein','Wolf','Schröder','Neumann','Schwarz','Zimmermann',
                 'Braun','Krüger','Hofmann','Hartmann','Lange','Schmitt','Werner','Schmitz','Krause','Meier',
                 'Lehmann','Schmid','Schulze','Maier','Köhler','Herrmann','König','Walter','Mayer','Huber',
                 'Kaiser','Fuchs','Peters','Lang','Scholz','Möller','Weiß','Jung','Hahn','Schubert',
                 'Vogel','Friedrich','Keller','Günther','Frank','Berger','Winkler','Roth','Beck','Lorenz',
                 'Baumann','Franke','Albrecht','Schuster','Simon','Ludwig','Böhm','Winter','Kraus','Martin',
                 'Schumacher','Krämer','Vogt','Stein','Jäger','Otto','Sommer','Groß','Seidel','Heinrich',
                 'Brandt','Haas','Schreiber','Graf','Schulte','Dietrich','Ziegler','Kuhn','Pohl','Engel',
                 'Horn','Busch','Bergmann','Voigt','Sauer','Arnold','Wolff','Pfeiffer','Hensel','Ernst'] AS last_names
  ), shuffled AS (
    SELECT id, row_number() OVER (ORDER BY random()) - 1 AS n FROM "Employee"
  )
  UPDATE "Employee" e
     SET "firstName" = names.first_names[1 + floor(random() * cardinality(names.first_names))::int],
         "lastName" = names.last_names[1 + (s.n % cardinality(names.last_names))::int],
         "updatedAt" = now()
    FROM shuffled s, names
   WHERE e.id = s.id;

  UPDATE "EmployeeAvailability" SET note = NULL WHERE note IS NOT NULL;
  UPDATE "EmployeeAbsence" SET note = NULL WHERE note IS NOT NULL;
  UPDATE "Wish" SET note = NULL, "decisionReason" = NULL WHERE note IS NOT NULL OR "decisionReason" IS NOT NULL;
  UPDATE "SwapRequest" SET "plannerDecisionReason" = NULL WHERE "plannerDecisionReason" IS NOT NULL;
  UPDATE "Schedule" SET "warningsJson" = NULL, "generationLog" = NULL, "scoreReport" = NULL;
  UPDATE "ScheduleVersion" SET "generationLog" = NULL, "scoreReport" = NULL;
  -- Planners can rename saved versions to any text; keep only the labels the app writes itself.
  UPDATE "ScheduleVersion" SET label = 'Manuell gesichert'
   WHERE label NOT IN ('Vor Neugenerierung', 'Automatisch generiert', 'Vor Bearbeitung', 'Manuell bearbeitet',
                       'Vor Leeren', 'Manuell gesichert', 'Vor Wiederherstellung');
  UPDATE "Facility" SET name = 'Demo-Einrichtung';

  RAISE NOTICE 'Demo data ready: % employees renamed; logins left: % and %',
    (SELECT count(*) FROM "Employee"), current_setting('demo.keep_email'), demo_email;
END
$anon$;

COMMIT;
