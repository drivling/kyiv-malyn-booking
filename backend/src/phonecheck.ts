import path from 'path';
import { spawn } from 'child_process';

export interface PhoneCheckResult {
  phone: string;
  url: string;
  hasData: boolean;
  html?: string | null;
}

export async function runPhoneCheckForPhone(phone: string): Promise<PhoneCheckResult | null> {
  const normalized = phone?.trim().replace(/^\+/, '');
  if (!normalized) return null;

  const pythonCmd =
    process.env.PHONECHECK_PYTHON?.trim() ||
    process.env.OPENDATABOT_PYTHON?.trim() ||
    process.env.TELEGRAM_USER_PYTHON?.trim() ||
    'python3';

  const scriptPath = path.join(__dirname, '..', 'phonecheck.top', 'run_phonecheck_lookup.py');

  return new Promise((resolve) => {
    const child = spawn(pythonCmd, [scriptPath, normalized], {
      env: {
        ...process.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const text = stdout.trim();
      if (code === 0 && text) {
        try {
          const data = JSON.parse(text) as {
            phone: string;
            url: string;
            has_data?: boolean;
            hasData?: boolean;
            html?: string | null;
          };
          const hasData = data.hasData ?? data.has_data ?? false;
          resolve({
            phone: data.phone || normalized,
            url: data.url,
            hasData,
            html: hasData ? (data.html ?? null) : null,
          });
        } catch (err) {
          console.error('resolvePhoneCheck: failed to parse JSON', err);
          resolve(null);
        }
      } else {
        if (code && code !== 0) {
          console.error(`ℹ️ runPhoneCheckForPhone (${normalized}): код ${code}`, stderr.slice(0, 200));
        }
        resolve(null);
      }
    });

    child.on('error', () => resolve(null));
  });
}

