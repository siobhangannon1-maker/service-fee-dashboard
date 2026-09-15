import { createClient } from '@supabase/supabase-js';

const url = process.env.BRANCH_SUPABASE_URL;
const anonKey = process.env.BRANCH_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing BRANCH_SUPABASE_URL or BRANCH_SUPABASE_ANON_KEY'
  );
}

const users = [
  {
    label: 'billing_staff',
    email: process.env.TEST_BILLING_EMAIL,
    password: process.env.TEST_BILLING_PASSWORD,
  },
  {
    label: 'admin',
    email: process.env.TEST_ADMIN_EMAIL,
    password: process.env.TEST_ADMIN_PASSWORD,
  },
  {
    label: 'typist',
    email: process.env.TEST_TYPIST_EMAIL,
    password: process.env.TEST_TYPIST_PASSWORD,
  },
  {
    label: 'inactive_billing',
    email: process.env.TEST_INACTIVE_EMAIL,
    password: process.env.TEST_INACTIVE_PASSWORD,
  },
];

function report(label, test, ok, detail = '') {
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | ${test}${
      detail ? ` | ${detail}` : ''
    }`
  );
}

async function makeClient(email, password) {
  if (!email || !password) {
    throw new Error('Missing synthetic test user credentials');
  }

  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  }

  return client;
}

async function getSyntheticFinancialRow(client) {
  return client
    .from('patient_financial_entries')
    .select(
      'id,patient_name,notes,deleted_at,deleted_by,is_review_locked,is_verified'
    )
    .eq('patient_name', 'Synthetic Test Patient')
    .limit(1)
    .maybeSingle();
}

async function getSyntheticDetailRow(client) {
  return client
    .from('billing_detail_entries')
    .select('id,patient_name,notes,deleted_at,deleted_by')
    .eq('patient_name', 'Synthetic Test Patient')
    .limit(1)
    .maybeSingle();
}

async function getSyntheticLockedRow(client) {
  return client
    .from('patient_financial_entries')
    .select('id,patient_name,is_review_locked')
    .eq('patient_name', 'Synthetic Locked Patient')
    .limit(1)
    .maybeSingle();
}

async function getSyntheticPeriodImport(client) {
  return client
    .from('billing_period_imports')
    .select('id')
    .limit(1)
    .maybeSingle();
}

async function testAnon() {
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: sessionData } = await client.auth.getSession();

  console.log(
    `INFO | anon | session=${
      sessionData.session ? 'PRESENT' : 'NONE'
    }`
  );

  for (const table of [
    'imports',
    'import_rows_raw',
    'import_rows_normalized',
    'billing_period_imports',
    'patient_financial_entries',
    'billing_detail_entries',
    'user_roles',
    'user_status',
  ]) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .limit(1);

    const denied =
      !!error ||
      (Array.isArray(data) && data.length === 0);

    report(
      'anon',
      `SELECT ${table} denied`,
      denied,
      error?.message || `rows=${data?.length ?? 0}`
    );
  }

  const { error } = await client.rpc(
    'billing_access_level_v1'
  );

  report(
    'anon',
    'RPC helper denied',
    !!error,
    error?.message || ''
  );
}

async function testRoleVisibility(user) {
  const client = await makeClient(
    user.email,
    user.password
  );

  const { data: level, error: levelError } =
    await client.rpc('billing_access_level_v1');

  report(
    user.label,
    'access level',
    !levelError,
    levelError?.message || `level=${level}`
  );

  const financial =
    await getSyntheticFinancialRow(client);
  const detail =
    await getSyntheticDetailRow(client);
  const periodImport =
    await getSyntheticPeriodImport(client);

  const shouldSeePatientRows =
    user.label === 'billing_staff' ||
    user.label === 'admin';

  const shouldSeePeriodImport =
    user.label === 'admin';

  report(
    user.label,
    'known patient_financial row visibility',
    shouldSeePatientRows
      ? !financial.error && !!financial.data
      : !financial.error && !financial.data,
    financial.error?.message ||
      `visible=${!!financial.data}`
  );

  report(
    user.label,
    'known billing_detail row visibility',
    shouldSeePatientRows
      ? !detail.error && !!detail.data
      : !detail.error && !detail.data,
    detail.error?.message ||
      `visible=${!!detail.data}`
  );

  report(
    user.label,
    'billing_period_imports visibility',
    shouldSeePeriodImport
      ? !periodImport.error && !!periodImport.data
      : !periodImport.error && !periodImport.data,
    periodImport.error?.message ||
      `visible=${!!periodImport.data}`
  );

  for (const table of [
    'imports',
    'import_rows_raw',
    'import_rows_normalized',
  ]) {
    const { error } = await client
      .from(table)
      .select('*')
      .limit(1);

    report(
      user.label,
      `${table} server-only`,
      !!error,
      error?.message || 'unexpectedly readable'
    );
  }

  await client.auth.signOut();
}

async function testBillingMutations() {
  const client = await makeClient(
    process.env.TEST_BILLING_EMAIL,
    process.env.TEST_BILLING_PASSWORD
  );

  const { data: financial } =
    await getSyntheticFinancialRow(client);

  const { data: detail } =
    await getSyntheticDetailRow(client);

  if (!financial) {
    throw new Error(
      'Synthetic Test Patient financial row not visible to billing_staff'
    );
  }

  if (!detail) {
    throw new Error(
      'Synthetic Test Patient billing detail row not visible to billing_staff'
    );
  }

  // Allowed normal financial update
  {
    const { data, error } = await client
      .from('patient_financial_entries')
      .update({
        notes: 'branch security test updated',
      })
      .eq('id', financial.id)
      .select('id')
      .maybeSingle();

    report(
      'billing_staff',
      'allowed financial update',
      !error && !!data,
      error?.message || `updated=${!!data}`
    );
  }

  // Verification field must not be browser writable
  {
    const { error } = await client
      .from('patient_financial_entries')
      .update({
        is_verified: true,
      })
      .eq('id', financial.id);

    report(
      'billing_staff',
      'is_verified update denied',
      !!error,
      error?.message || ''
    );
  }

  // Review lock field must not be browser writable
  {
    const { error } = await client
      .from('patient_financial_entries')
      .update({
        is_review_locked: true,
      })
      .eq('id', financial.id);

    report(
      'billing_staff',
      'is_review_locked update denied',
      !!error,
      error?.message || ''
    );
  }

  // Hard delete must fail
  {
    const { error } = await client
      .from('patient_financial_entries')
      .delete()
      .eq('id', financial.id);

    report(
      'billing_staff',
      'hard delete financial denied',
      !!error,
      error?.message || ''
    );
  }

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    throw new Error(
      'Could not resolve synthetic billing user'
    );
  }

  // Soft delete financial row
  {
    const { data, error } = await client
      .from('patient_financial_entries')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', financial.id)
      .select('id,deleted_at')
      .maybeSingle();

    report(
      'billing_staff',
      'soft delete financial',
      !error && !!data?.deleted_at,
      error?.message ||
        `deleted=${!!data?.deleted_at}`
    );
  }

  // Deleted row cannot be restored
  {
    const { data, error } = await client
      .from('patient_financial_entries')
      .update({
        deleted_at: null,
        deleted_by: null,
      })
      .eq('id', financial.id)
      .select('id');

    report(
      'billing_staff',
      'restore deleted financial denied',
      !!error || data?.length === 0,
      error?.message ||
        `rows=${data?.length ?? 0}`
    );
  }

  // Deleted row cannot be edited
  {
    const { data, error } = await client
      .from('patient_financial_entries')
      .update({
        notes: 'should not change',
      })
      .eq('id', financial.id)
      .select('id');

    report(
      'billing_staff',
      'edit deleted financial denied',
      !!error || data?.length === 0,
      error?.message ||
        `rows=${data?.length ?? 0}`
    );
  }

  // Allowed billing detail update
  {
    const { data, error } = await client
      .from('billing_detail_entries')
      .update({
        notes: 'branch detail updated',
      })
      .eq('id', detail.id)
      .select('id')
      .maybeSingle();

    report(
      'billing_staff',
      'allowed billing detail update',
      !error && !!data,
      error?.message ||
        `updated=${!!data}`
    );
  }

  // Hard delete billing detail must fail
  {
    const { error } = await client
      .from('billing_detail_entries')
      .delete()
      .eq('id', detail.id);

    report(
      'billing_staff',
      'hard delete billing detail denied',
      !!error,
      error?.message || ''
    );
  }

  // Soft delete billing detail
  {
    const { data, error } = await client
      .from('billing_detail_entries')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', detail.id)
      .select('id,deleted_at')
      .maybeSingle();

    report(
      'billing_staff',
      'soft delete billing detail',
      !error && !!data?.deleted_at,
      error?.message ||
        `deleted=${!!data?.deleted_at}`
    );
  }

  // Restore billing detail must fail
  {
    const { data, error } = await client
      .from('billing_detail_entries')
      .update({
        deleted_at: null,
        deleted_by: null,
      })
      .eq('id', detail.id)
      .select('id');

    report(
      'billing_staff',
      'restore billing detail denied',
      !!error || data?.length === 0,
      error?.message ||
        `rows=${data?.length ?? 0}`
    );
  }

  await client.auth.signOut();
}

async function testLockedRow() {
  const client = await makeClient(
    process.env.TEST_BILLING_EMAIL,
    process.env.TEST_BILLING_PASSWORD
  );

  const { data: locked, error: readError } =
    await getSyntheticLockedRow(client);

  if (readError) {
    report(
      'billing_staff',
      'locked row visible for test',
      false,
      readError.message
    );
    await client.auth.signOut();
    return;
  }

  if (!locked) {
    report(
      'billing_staff',
      'locked row exists',
      false,
      'Synthetic Locked Patient not found'
    );
    await client.auth.signOut();
    return;
  }

  report(
    'billing_staff',
    'locked row exists',
    locked.is_review_locked === true,
    `is_review_locked=${locked.is_review_locked}`
  );

  const { data, error } = await client
    .from('patient_financial_entries')
    .update({
      notes: 'should not update locked row',
    })
    .eq('id', locked.id)
    .select('id');

  report(
    'billing_staff',
    'locked financial row edit denied',
    !!error || data?.length === 0,
    error?.message ||
      `rows=${data?.length ?? 0}`
  );

  await client.auth.signOut();
}

await testAnon();

for (const user of users) {
  await testRoleVisibility(user);
}

await testBillingMutations();

await testLockedRow();