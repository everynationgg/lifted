DO $$
DECLARE
  v_admin_id uuid := '11111111-aaaa-bbbb-cccc-111111111111';
  v_member_id uuid := '22222222-aaaa-bbbb-cccc-222222222222';
BEGIN
  -- Insert cherie@lifted.app admin
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_admin_id,
    'authenticated',
    'authenticated',
    'cherie@lifted.app',
    crypt('AdminTest2026!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Cherie Magsanoc"}',
    now(),
    now()
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = crypt('AdminTest2026!', gen_salt('bf')),
    email_confirmed_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_admin_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Insert member@lifted.app ordinary member
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_member_id,
    'authenticated',
    'authenticated',
    'member@lifted.app',
    crypt('MemberTest2026!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Ordinary Member"}',
    now(),
    now()
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = crypt('MemberTest2026!', gen_salt('bf')),
    email_confirmed_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_member_id, 'member')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
