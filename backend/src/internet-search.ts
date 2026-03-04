import path from 'path';
import { spawn } from 'child_process';

export interface InternetSearchResultItem {
  source: string;
  title: string;
  url: string;
  snippet: string;
}

export interface InternetSearchResult {
  phone: string;
  searchUrls: Record<string, string>;
  hasData: boolean;
  results: InternetSearchResultItem[];
  error?: string;
}

export async function runInternetSearchForPhone(phone: string): Promise<InternetSearchResult | null> {
  const normalized = phone?.trim().replace(/^\+/, '');
  if (!normalized) return null;

  const pythonCmd =
    process.env.OPENDATABOT_PYTHON?.trim() ||
    process.env.TELEGRAM_USER_PYTHON?.trim() ||
    'python3';

  const scriptPath = path.join(__dirname, '..', 'internet-phone-search', 'run_internet_phone_search.py');

  return new Promise((resolve) => {
    const child = spawn(pythonCmd, [scriptPath, normalized], {
      env: { ...process.env },
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
          const data = JSON.parse(text) as InternetSearchResult;
          resolve(data);
        } catch {
          console.error('runInternetSearchForPhone: failed to parse JSON', stderr.slice(0, 200));
          resolve({
            phone: normalized,
            searchUrls: {},
            hasData: false,
            results: [],
            error: 'Invalid JSON from script',
          });
        }
      } else {
        if (code && code !== 0) {
          console.error(`[internet-search] ${normalized}: код ${code}`, stderr.slice(0, 200));
        }
        resolve({
          phone: normalized,
          searchUrls: {},
          hasData: false,
          results: [],
          error: stderr.slice(0, 200) || 'Script failed',
        });
      }
    });

    child.on('error', () => {
      resolve({
        phone: normalized,
        searchUrls: {},
        hasData: false,
        results: [],
        error: 'Spawn error',
      });
    });
  });
}
