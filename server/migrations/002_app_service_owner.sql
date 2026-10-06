-- 002: the App Service app takes over the database objects (decision P58).
--
-- Phase 1 created every table as the database role of the Azure Functions app (func-li-dance-events). That
-- app is gone, but its role still owns the tables, so only it could change their design later, and Azure
-- cannot remove the role while it owns them. The app running this step (current_user) becomes the owner.
-- If Azure does not allow it, nothing breaks: the app can already read and write; the warning shows in
-- the log and docs/deployment.md says how to do it by hand. Where the old role does not exist (tests, a
-- restored copy after the role was removed), this does nothing.
DO $$
DECLARE
  old_role text;
BEGIN
  FOR old_role IN SELECT rolname FROM pg_roles WHERE rolname = 'func-li-dance-events' AND rolname <> current_user LOOP
    BEGIN
      EXECUTE format('GRANT %I TO %I', old_role, current_user);
      EXECUTE format('REASSIGN OWNED BY %I TO %I', old_role, current_user);
      RAISE NOTICE 'everything of % now belongs to %', old_role, current_user;
    EXCEPTION WHEN insufficient_privilege OR invalid_grant_operation THEN
      RAISE WARNING 'could not take over the objects of %: %', old_role, SQLERRM;
    END;
  END LOOP;
END $$;
