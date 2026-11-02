const XLSX = require('xlsx');

const SECCION_MAP = {
  '1': 'Automotores',
  '01': 'Automotores',
  '2': 'Motovehículos',
  '02': 'Motovehículos',
  '3': 'Incendio',
  '03': 'Incendio',
  '4': 'Cristales',
  '04': 'Cristales',
  '5': 'Transporte',
  '05': 'Transporte',
  '6': 'Responsabilidad Civil',
  '06': 'Responsabilidad Civil',
  '8': 'Combinado Familiar',
  '08': 'Combinado Familiar',
  '9': 'Integral de Comercio',
  '09': 'Integral de Comercio',
  '10': 'Accidentes Personales',
  '11': 'Vida Colectivo',
  '14': 'Seguro Técnico',
  '18': 'Vida Individual',
  '19': 'Sepelio',
  '21': 'Caución'
};

function findRowValue(row, patterns) {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row);
  for (const pattern of patterns) {
    const matchedKey = keys.find(k => pattern.test(k.trim()));
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
      return row[matchedKey];
    }
  }
  return null;
}

function parseExcelMoney(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim();
  if (!str) return 0;

  // Remover todo excepto dígitos, puntos, comas y signo menos
  str = str.replace(/[^0-9.,-]/g, '');
  if (!str || str === '-') return 0;

  // Si tiene puntos y comas: ej '125.450,50' o '125,450.50'
  if (str.includes('.') && str.includes(',')) {
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastComma > lastDot) {
      // 125.450,50 -> punto es miles, coma es decimal
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // 125,450.50 -> coma es miles, punto es decimal
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Solo tiene coma: ej '125450,50' o '150,00' o '1,250'
    const parts = str.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Coma decimal (ej: 125,50 o 1500,0)
      str = str.replace(',', '.');
    } else if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      // Coma de miles (ej: 1,250 o 1,250,000)
      str = str.replace(/,/g, '');
    } else {
      str = str.replace(',', '.');
    }
  } else if (str.includes('.')) {
    // Solo tiene punto: ej '15.000' o '125.450' o '15.5'
    const parts = str.split('.');
    if (parts.length === 2 && parts[1].length === 3 && parseInt(parts[0], 10) > 0) {
      // Punto de miles argentino típico (ej: 15.000, 85.500)
      str = str.replace(/\./g, '');
    } else if (parts.length > 2) {
      // Múltiples puntos de miles (ej: 1.250.000)
      str = str.replace(/\./g, '');
    }
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

const cleanMoney = parseExcelMoney;

function parseExcelDate(val, defaultToToday = false) {
  if (!val) {
    return defaultToToday ? new Date().toISOString().substring(0, 10) : null;
  }

  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val.toISOString().substring(0, 10);
  }

  // Si es un número serial de Excel (ej: 44561)
  if (typeof val === 'number') {
    if (val > 10000 && val < 60000) {
      const utcDays = Math.floor(val - 25569);
      const utcValue = utcDays * 86400;
      const dateInfo = new Date(utcValue * 1000);
      return dateInfo.toISOString().split('T')[0];
    }
    return defaultToToday ? new Date().toISOString().substring(0, 10) : null;
  }

  const str = String(val).trim();

  // Formato DD/MM/YYYY o DD-MM-YYYY
  const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }

  // Formato YYYY-MM-DD
  const yyyymmdd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (yyyymmdd) {
    const year = yyyymmdd[1];
    const month = yyyymmdd[2].padStart(2, '0');
    const day = yyyymmdd[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return defaultToToday ? new Date().toISOString().substring(0, 10) : null;
}

function parseExcelBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const error = new Error('El archivo no contiene un búfer válido.');
    error.status = 400;
    throw error;
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
    const error = new Error('El archivo Excel no contiene hojas válidas.');
    error.status = 400;
    throw error;
  }

  const allRows = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    let sheetData = XLSX.utils.sheet_to_json(worksheet);

    // Auto-detectar fila de encabezados si hay títulos en las filas superiores
    if (sheetData.length === 0 || !sheetData.some(row => findRowValue(row, [/nombre/i, /cliente/i, /poliza/i, /tomador/i]))) {
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const headerIndex = rawRows.findIndex(r =>
        Array.isArray(r) && r.length >= 2 && r.some(cell =>
          typeof cell === 'string' && /^(Nombre|Cliente|Tomador|Asegurado|Póliza|Poliza|Nro Póliza|DNI|CUIT)$/i.test(cell.trim())
        )
      );

      if (headerIndex !== -1) {
        const headers = rawRows[headerIndex];
        sheetData = rawRows.slice(headerIndex + 1).filter(r => r && r.length > 1).map(r => {
          const obj = {};
          headers.forEach((h, i) => {
            if (h && r[i] !== undefined) obj[String(h).trim()] = r[i];
          });
          return obj;
        });
      }
    }

    if (sheetData && sheetData.length > 0) {
      allRows.push(...sheetData);
    }
  }

  if (allRows.length === 0) {
    const error = new Error('El archivo Excel está vacío o no contiene filas con datos procesables.');
    error.status = 400;
    throw error;
  }

  return allRows;
}

module.exports = {
  SECCION_MAP,
  findRowValue,
  cleanMoney,
  parseExcelMoney,
  parseExcelDate,
  parseExcelBuffer
};
