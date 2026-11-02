-- =====================================================================
-- 0013 Roles: student, lecturer, course coordinator, admin
--   Everyone who was an "instructor" becomes a "lecturer" (the enum value is
--   renamed, so profiles and staff invites follow automatically), and a new
--   "coordinator" role sits between lecturer and admin.
--   Kept on its own: a new enum value cannot be used in the transaction
--   that adds it. 0014 rewrites the permissions that use these roles.
-- =====================================================================

alter type public.app_role rename value 'instructor' to 'lecturer';
alter type public.app_role add value if not exists 'coordinator' after 'lecturer';
