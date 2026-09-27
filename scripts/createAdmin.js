#!/usr/bin/env node
/**
 * Admin / Platform Owner Provisioning CLI
 *
 * Replaces the old hard-coded, auto-seeded development admin accounts.
 * Privileged accounts are now created explicitly and stored in MongoDB.
 *
 * Usage:
 *   npm run create-admin -- --email admin@yourdomain.com --password 'Str0ngPass!' --name "Platform Admin"
 *   npm run create-admin -- --email owner@yourdomain.com --password 'Str0ngPass!' --role platform_owner
 *
 * Flags:
 *   --email      (required) login email
 *   --password   (required) at least 8 chars, 1 uppercase, 1 number
 *   --name       business/display name          (default: "Platform Administration")
 *   --phone      optional Nigerian phone number
 *   --role       seller | admin | platform_owner (default: admin)
 *   --promote    promote the account to --role if the email already exists
 */

require('dotenv').config();

const { connectDB, disconnectDB } = require('../config/db');
const authService = require('../services/auth/authService');
const User = require('../models/User');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = typeof args.email === 'string' ? args.email : '';
  const password = typeof args.password === 'string' ? args.password : '';
  const role = typeof args.role === 'string' ? args.role : 'admin';
  const businessName = typeof args.name === 'string' ? args.name : 'Platform Administration';
  const phone = typeof args.phone === 'string' ? args.phone : '';

  if (!email || !password) {
    console.error('Error: --email and --password are required.\n');
    console.error("Example: npm run create-admin -- --email admin@yourdomain.com --password 'Str0ngPass1'");
    process.exitCode = 1;
    return;
  }

  if (!authService.VALID_ROLES.includes(role)) {
    console.error(`Error: invalid --role "${role}". Allowed: ${authService.VALID_ROLES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  await connectDB();

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    if (!args.promote) {
      console.error(
        `Error: a user with email "${normalizedEmail}" already exists (role: ${existing.role}).\n` +
          'Re-run with --promote to change its role.'
      );
      process.exitCode = 1;
      await disconnectDB();
      return;
    }

    existing.role = role;
    await existing.save();
    console.log(`Promoted existing account ${normalizedEmail} to role "${role}".`);
    await disconnectDB();
    return;
  }

  const user = await authService.createAccount({
    businessName,
    email: normalizedEmail,
    password,
    phone,
    role,
  });

  console.log('Account created successfully:');
  console.log(`  id:    ${user._id.toString()}`);
  console.log(`  email: ${user.email}`);
  console.log(`  role:  ${user.role}`);

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Failed to provision account:', err.message);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});
