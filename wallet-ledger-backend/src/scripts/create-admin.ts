/**
 * One-time bootstrap script: creates the FIRST Admin account directly
 * against the database, bypassing the HTTP API entirely.
 *
 * Why this can't just be a route: POST /users/staff (the normal way to mint
 * a SUPPORT/ADMIN account) is itself Admin-only - on a brand new deployment
 * there is no Admin yet to call it. This script is the one deliberate
 * exception to "every privileged account is created by an existing Admin",
 * and it exists specifically to break that chicken-and-egg problem exactly
 * once per environment.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/create-admin.ts \
 *     --email admin@example.com --password "a-strong-password-here" --name "Platform Admin"
 *
 * Safe to re-run: if an account with that email already exists, it reports
 * that and exits without changing anything - it does NOT promote an
 * existing user's role, since silently elevating a user to Admin is exactly
 * the kind of thing that should never happen without a human reading output
 * and deciding to run this deliberately with --promote (below).
 */
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { typeOrmConfig } from '../data-source';
import { UserRole } from '../common/types/roles.enum';
import { User } from 'src/database/entities/users.entity';

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

interface ParsedArgs {
  email: string;
  password: string;
  name: string;
  promote: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const email = get('--email');
  const password = get('--password');
  const name = get('--name') ?? 'Platform Admin';
  const promote = argv.includes('--promote');

  if (!email || !password) {
    console.error(
      'Usage: create-admin --email <email> --password <password> [--name "Full Name"] [--promote]',
    );
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }

  return { email, password, name, promote };
}

async function main() {
  const { email, password, name, promote } = parseArgs(process.argv.slice(2));

  const dataSource = new DataSource(typeOrmConfig);
  await dataSource.initialize();

  try {
    const users = dataSource.getRepository(User);
    const existing = await users.findOne({ where: { email } });

    if (existing) {
      if (existing.role === UserRole.ADMIN) {
        console.log(
          `User ${email} already exists and is already an ADMIN. Nothing to do.`,
        );
        return;
      }

      if (!promote) {
        console.log(
          `User ${email} already exists with role ${existing.role}. ` +
            `Re-run with --promote to elevate this existing account to ADMIN, ` +
            `or use a different email to create a new Admin account.`,
        );
        return;
      }

      await users.update({ id: existing.id }, { role: UserRole.ADMIN });
      console.log(`Promoted existing user ${email} (${existing.id}) to ADMIN.`);
      return;
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const created = await users.save(
      users.create({
        id: randomUUID(),
        email,
        fullName: name,
        passwordHash,
        role: UserRole.ADMIN,
      }),
    );

    console.log(`Created Admin account: ${created.email} (${created.id})`);
    console.log(
      'Log in via POST /auth/login with the email/password you just provided.',
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(
    'create-admin failed:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
