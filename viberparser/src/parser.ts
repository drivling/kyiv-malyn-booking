/**
 * Парсер повідомлень з Viber групи
 * Розпізнає маршрути, дати, час, місця
 */

interface ParsedRide {
  route: string | null;
  departureDate: Date | null;
  departureTime: string | null;
  availableSeats: number | null;
  price: number | null;
  contactPhone: string | null;
  contactName: string | null;
  isParsed: boolean;
  parsingErrors: string | null;
}

export class MessageParser {
  // Регулярні вирази для розпізнавання
  private routePatterns = [
    // Київ -> Малин/Ірпінь/Буча
    /(?:київ|киев|kyiv|k)\s*[-–—>→]\s*(?:малин|malyn|m|ірпінь|irpin|буча|bucha)/gi,
    // Малин -> Київ
    /(?:малин|malyn|m)\s*[-–—>→]\s*(?:київ|киев|kyiv|k|ірпінь|irpin|буча|bucha)/gi,
    // Ірпінь -> Київ/Малин
    /(?:ірпінь|irpin)\s*[-–—>→]\s*(?:київ|киев|kyiv|k|малин|malyn|m)/gi,
    // Буча -> Київ/Малин
    /(?:буча|bucha)\s*[-–—>→]\s*(?:київ|киев|kyiv|k|малин|malyn|m)/gi,
  ];

  private datePatterns = [
    // 28.01, 28/01, 28-01
    /(\d{1,2})[\.\/\-](\d{1,2})(?:[\.\/\-](\d{2,4}))?/g,
    // Завтра, сьогодні
    /(?:завтра|сьогодні|сегодня|today|tomorrow)/gi,
    // Дні тижня
    /(?:понеділок|вівторок|середа|четвер|п'ятниця|субота|неділя|пн|вт|ср|чт|пт|сб|нд)/gi,
  ];

  private timePatterns = [
    // 08:00, 8:00, 08.00
    /(\d{1,2})[:\.،](\d{2})/g,
    // о 8, о 18
    /\bо\s*(\d{1,2})\b/gi,
  ];

  private seatsPatterns = [
    // "3 місця", "2 места", "1 місце"
    /(\d+)\s*(?:місц[ья]|місце|мест[оа]|seat[s]?)/gi,
    // "є 2", "є 3"
    /є\s*(\d+)/gi,
  ];

  private pricePatterns = [
    // "100 грн", "150грн", "$5"
    /(\d+)\s*(?:грн|uah|₴|\$)/gi,
  ];

  private phonePatterns = [
    // Українські номери: +380, 380, 0
    /(?:\+38|38|0)?\s*\(?\d{2,3}\)?\s*\d{3}[-\s]?\d{2}[-\s]?\d{2}/g,
  ];

  /**
   * Головний метод парсингу
   */
  parse(text: string, timestamp: Date): ParsedRide {
    const errors: string[] = [];
    
    try {
      const route = this.parseRoute(text);
      const departureDate = this.parseDate(text, timestamp);
      const departureTime = this.parseTime(text);
      const availableSeats = this.parseSeats(text);
      const price = this.parsePrice(text);
      const contactPhone = this.parsePhone(text);
      
      const isParsed = !!(route && (departureDate || departureTime));
      
      if (!route) errors.push('Route not found');
      if (!departureDate && !departureTime) errors.push('Date/time not found');

      return {
        route,
        departureDate,
        departureTime,
        availableSeats,
        price,
        contactPhone,
        contactName: null, // Можна додати парсинг імен
        isParsed,
        parsingErrors: errors.length > 0 ? errors.join('; ') : null,
      };
    } catch (error) {
      return {
        route: null,
        departureDate: null,
        departureTime: null,
        availableSeats: null,
        price: null,
        contactPhone: null,
        contactName: null,
        isParsed: false,
        parsingErrors: `Parse error: ${error}`,
      };
    }
  }

  private parseRoute(text: string): string | null {
    const normalized = text.toLowerCase();
    
    for (const pattern of this.routePatterns) {
      const match = pattern.exec(normalized);
      if (match) {
        return this.normalizeRoute(match[0]);
      }
    }
    
    return null;
  }

  private normalizeRoute(rawRoute: string): string {
    const route = rawRoute.toLowerCase()
      .replace(/[-–—>→]/g, '-')
      .replace(/\s+/g, '');
    
    // Нормалізація назв
    const cityMap: Record<string, string> = {
      'київ': 'Kyiv',
      'киев': 'Kyiv',
      'kyiv': 'Kyiv',
      'k': 'Kyiv',
      'малин': 'Malyn',
      'malyn': 'Malyn',
      'm': 'Malyn',
      'ірпінь': 'Irpin',
      'irpin': 'Irpin',
      'буча': 'Bucha',
      'bucha': 'Bucha',
    };
    
    const parts = route.split('-');
    const normalized = parts.map(p => cityMap[p] || p).join('-');
    
    return normalized.split('-').map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join('-');
  }

  private parseDate(text: string, referenceDate: Date): Date | null {
    // Спроба знайти конкретну дату
    const dateMatch = /(\d{1,2})[\.\/\-](\d{1,2})/.exec(text);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10) - 1; // Місяці в JS з 0
      const year = referenceDate.getFullYear();
      
      if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
        const date = new Date(year, month, day);
        
        // Якщо дата в минулому, додаємо рік
        if (date < referenceDate) {
          date.setFullYear(year + 1);
        }
        
        return date;
      }
    }
    
    // Відносні дати
    if (/завтра|tomorrow/gi.test(text)) {
      const tomorrow = new Date(referenceDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    
    if (/сьогодні|сегодня|today/gi.test(text)) {
      return new Date(referenceDate);
    }
    
    return null;
  }

  private parseTime(text: string): string | null {
    const timeMatch = /(\d{1,2})[:\.،](\d{2})/.exec(text);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      }
    }
    
    // "о 8", "о 18"
    const hourMatch = /\bо\s*(\d{1,2})\b/i.exec(text);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1], 10);
      if (hour >= 0 && hour <= 23) {
        return `${hour.toString().padStart(2, '0')}:00`;
      }
    }
    
    return null;
  }

  private parseSeats(text: string): number | null {
    const seatsMatch = /(\d+)\s*(?:місц[ья]|місце|мест[оа]|seat)/i.exec(text);
    if (seatsMatch) {
      return parseInt(seatsMatch[1], 10);
    }
    
    const hasMatch = /є\s*(\d+)/i.exec(text);
    if (hasMatch) {
      return parseInt(hasMatch[1], 10);
    }
    
    return null;
  }

  private parsePrice(text: string): number | null {
    const priceMatch = /(\d+)\s*(?:грн|uah|₴)/i.exec(text);
    if (priceMatch) {
      return parseInt(priceMatch[1], 10);
    }
    
    return null;
  }

  private parsePhone(text: string): string | null {
    const phoneMatch = /(?:\+38|38|0)?\s*\(?\d{2,3}\)?\s*\d{3}[-\s]?\d{2}[-\s]?\d{2}/.exec(text);
    if (phoneMatch) {
      // Нормалізація номера
      return phoneMatch[0].replace(/\s/g, '');
    }
    
    return null;
  }
}
