/**
 * Талон на проїзд після ролика: номер завжди «щасливий» (сума перших трьох цифр дорівнює сумі останніх — як
 * рахували на старих талонах), а компостер пробиває три клітинки з девʼяти.
 */
type Random = () => number;

const pick = <T>(list: T[], random: Random): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

/** «042 357»: шість цифр, перші три в сумі як останні три */
export function luckyTicketNumber(random: Random = Math.random): string {
  const head = [0, 1, 2].map(() => Math.min(9, Math.floor(random() * 10)));
  const sum = head[0] + head[1] + head[2];
  const tails: number[][] = [];
  for (let a = 0; a <= 9; a++) {
    for (let b = 0; b <= 9; b++) {
      const c = sum - a - b;
      if (c >= 0 && c <= 9) tails.push([a, b, c]);
    }
  }
  return `${head.join('')} ${pick(tails, random).join('')}`;
}

export function isLucky(no: string): boolean {
  const d = no.replace(/\D/g, '').split('').map(Number);
  return d.length === 6 && d[0] + d[1] + d[2] === d[3] + d[4] + d[5];
}

/** Три різні клітинки сітки 3 × 3 (0…8); перша — та дірка, крізь яку відкриється сторінка */
export function punchCells(random: Random = Math.random): number[] {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const out: number[] = [];
  while (out.length < 3) {
    const cell = pick(cells, random);
    cells.splice(cells.indexOf(cell), 1);
    out.push(cell);
  }
  return out;
}
