/**
 * Normaliza cadenas de texto para facilitar comparaciones
 */
function cleanText(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Parsea el buffer de un PDF de póliza y extrae datos de Asegurado, Vehículo y Póliza.
 *
 * @param {Buffer} pdfBuffer - Buffer binario del PDF
 * @returns {Promise<Object>} Objeto estructurado con los datos extraídos
 */
async function parsePolicyPdfBuffer(pdfBuffer) {
  let rawText = '';
  const pdfParseModule = require('pdf-parse');

  if (typeof pdfParseModule === 'function') {
    const data = await pdfParseModule(pdfBuffer);
    rawText = data.text || '';
  } else if (pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
    const parser = new pdfParseModule.PDFParse({
      data: new Uint8Array(pdfBuffer),
      verbosity: 0
    });
    await parser.load();
    const parsedResult = await parser.getText();
    rawText = typeof parsedResult === 'string' ? parsedResult : (parsedResult.text || parsedResult.pages?.map(p => p.text).join('\n') || '');
  } else {
    throw new Error('No se pudo inicializar la librería pdf-parse.');
  }
  
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const fullSingleLineText = lines.join(' ');

  // 1. COMPAÑÍA ASEGURADORA
  let compania = 'Desconocida';
  if (/EL NORTE/i.test(fullSingleLineText)) compania = 'El Norte Seguros';
  else if (/SANCOR/i.test(fullSingleLineText)) compania = 'Sancor Seguros';
  else if (/FEDERACI[OÓ]N PATRONAL/i.test(fullSingleLineText)) compania = 'Federación Patronal';
  else if (/LA SEGUNDA/i.test(fullSingleLineText)) compania = 'La Segunda';
  else if (/ZURICH/i.test(fullSingleLineText)) compania = 'Zurich';
  else if (/RIVADAVIA/i.test(fullSingleLineText)) compania = 'Rivadavia';
  else if (/SAN CRIST[OÓ]BAL/i.test(fullSingleLineText)) compania = 'San Cristóbal';
  else if (/MAPFRE/i.test(fullSingleLineText)) compania = 'Mapfre';
  else if (/ALLIANZ/i.test(fullSingleLineText)) compania = 'Allianz';
  else if (/MERCANTIL ANDINA/i.test(fullSingleLineText)) compania = 'Mercantil Andina';

  // 2. CLIENTE / ASEGURADO
  let nombreCliente = '';
  // Buscar en líneas individuales primero
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^Nombre\b/i.test(line) || /Tomador|Asegurado/i.test(line)) {
      // Ejemplo: "Nombre (1.116.571) BERGIA, JORGE FABIAN"
      let candidate = line.replace(/^Nombre\s*(?:\([\d\.]+\))?/i, '').replace(/^(?:Tomador|Asegurado)\s*:?/i, '').trim();
      if (!candidate && idx + 1 < lines.length) {
        candidate = lines[idx + 1];
      }
      candidate = candidate.replace(/\([\d\.]+\)/g, '').replace(/Documento.*/i, '').replace(/CUIT.*/i, '').replace(/DNI.*/i, '').trim();
      if (candidate && candidate.length > 3 && !/^\d+$/.test(candidate)) {
        nombreCliente = candidate;
        break;
      }
    }
  }

  if (!nombreCliente) {
    const mNombre = fullSingleLineText.match(/(?:Nombre|Asegurado|Tomador)\s*(?:\([\d\.]+\))?\s*:?\s*([A-Z\s,ÁÉÍÓÚÑ]{3,40})(?=\s+Documento|\s+CUIT|\s+DNI|\s+Domicilio|$)/i);
    if (mNombre) nombreCliente = cleanText(mNombre[1]);
  }

  // Normalizar "APELLIDO, NOMBRE" -> "NOMBRE APELLIDO"
  if (nombreCliente.includes(',')) {
    const parts = nombreCliente.split(',').map(p => p.trim());
    if (parts.length === 2) {
      nombreCliente = `${parts[1]} ${parts[0]}`;
    }
  }
  nombreCliente = nombreCliente.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // CUIT / DNI
  let dniCuit = '';
  const mCuit = fullSingleLineText.match(/(?:CUIT|CUIL|Documento)\s*:?\s*(\d{2}[-\s]?\d{8}[-\s]?\d{1}|\d{11})/i);
  if (mCuit) {
    dniCuit = mCuit[1].replace(/[^0-9]/g, '');
    if (dniCuit.length === 11) {
      dniCuit = `${dniCuit.substring(0,2)}-${dniCuit.substring(2,10)}-${dniCuit.substring(10,11)}`;
    }
  } else {
    const mDni = fullSingleLineText.match(/(?:DNI|Doc\.?)\s*:?\s*(\d{7,8})/i);
    if (mDni) dniCuit = mDni[1];
  }

  // Domicilio
  let direccion = '';
  const mDir = fullSingleLineText.match(/Domicilio\s*:?\s*([^\n]+?)(?=\s+Localidad|\s+Teléfono|\s+IVA|$)/i);
  if (mDir) direccion = cleanText(mDir[1]);

  // Localidad
  let localidad = '';
  const mLoc = fullSingleLineText.match(/Localidad\s*:?\s*(?:\(\d+\))?\s*([A-Z\sÁÉÍÓÚÑ]+?)(?=\s*,|\s+CORDOBA|\s+BUENOS AIRES|\s+SANTA FE|\s+Teléfono|\s+IVA|$)/i);
  if (mLoc) localidad = cleanText(mLoc[1]);

  // Provincia
  let provincia = '';
  if (/CORDOBA|CÓRDOBA/i.test(fullSingleLineText)) provincia = 'Córdoba';
  else if (/BUENOS AIRES/i.test(fullSingleLineText)) provincia = 'Buenos Aires';
  else if (/CABA|CAPITAL FEDERAL/i.test(fullSingleLineText)) provincia = 'CABA';
  else if (/SANTA FE/i.test(fullSingleLineText)) provincia = 'Santa Fe';
  else if (/MENDOZA/i.test(fullSingleLineText)) provincia = 'Mendoza';
  else if (/TUCUMAN|TUCUMÁN/i.test(fullSingleLineText)) provincia = 'Tucumán';
  else if (/ENTRE RIOS|ENTRE RÍOS/i.test(fullSingleLineText)) provincia = 'Entre Ríos';

  // Teléfono
  let telefono = '';
  const mTel = fullSingleLineText.match(/(?:Teléfono|Tel|Celular)\s*:?\s*([\d\(\)\s-]{7,18})/i);
  if (mTel) telefono = cleanText(mTel[1]).replace(/[^0-9]/g, '');

  // 3. VEHÍCULO
  let patente = '';
  const mPat = fullSingleLineText.match(/(?:Dominio|Patente)\s*:?\s*([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})/i);
  if (mPat) patente = mPat[1].replace(/\s+/g, '').toUpperCase();

  let vehiculoStr = '';
  const mVeh = fullSingleLineText.match(/Vehículo\s*(?:\d+)?\s*-?\s*([A-Z0-9\s\/\.-]{5,60})(?=\s+Año|\s+Dominio|\s+Tipo|$)/i);
  if (mVeh) vehiculoStr = cleanText(mVeh[1]);

  let marca = '';
  let modelo = '';
  let version = '';

  const carBrands = ['CHEVROLET','TOYOTA','FORD','FIAT','PEUGEOT','VOLKSWAGEN','RENAULT','CITROEN','HONDA','NISSAN','HYUNDAI','JEEP','RAM','MERCEDES','BMW','AUDI'];
  for (const b of carBrands) {
    if (new RegExp('\\b' + b + '\\b', 'i').test(vehiculoStr || fullSingleLineText)) {
      marca = b.charAt(0) + b.slice(1).toLowerCase();
      if (marca === 'Volkswagen') marca = 'Volkswagen';
      break;
    }
  }

  if (vehiculoStr) {
    let cleanVeh = vehiculoStr
      .replace(new RegExp(marca, 'gi'), '')
      .replace(/-\s*[A-Z0-9\s]{6,8}$/gi, '')
      .trim();
    
    // Quitar números iniciales tipo "1 - "
    cleanVeh = cleanVeh.replace(/^\d+\s*-\s*/, '').trim();

    const parts = cleanVeh.split(' ').filter(Boolean);
    if (parts.length > 0) {
      modelo = parts[0];
      version = parts.slice(1).join(' ').replace(/-?\s*[A-Z]{2,3}\d{3}[A-Z]{0,2}/gi, '').trim();
    }
  }

  let anio = null;
  const mAnio = fullSingleLineText.match(/Año\s*:?\s*(\d{4})/i);
  if (mAnio) anio = parseInt(mAnio[1]);

  let motor = '';
  const mMotor = fullSingleLineText.match(/Motor\s*:?\s*([A-Z0-9-]+)/i);
  if (mMotor) motor = mMotor[1];

  let chasis = '';
  const mChasis = fullSingleLineText.match(/Chasis\s*:?\s*([A-Z0-9]{10,20})/i);
  if (mChasis) chasis = mChasis[1];

  let uso = 'particular';
  if (/COMERC|COMERCIAL|CARGA/i.test(fullSingleLineText)) uso = 'comercial';

  // 4. PÓLIZA
  let numeroPoliza = '';
  const mPol = fullSingleLineText.match(/(?:Número|Póliza\s*Nº?)\s*:?\s*([\d\.-]{4,15})/i);
  if (mPol) numeroPoliza = mPol[1].trim();

  let fechaInicio = '';
  let fechaVencimiento = '';
  const mDesde = fullSingleLineText.match(/Vigencia\s+desde\s*:?\s*(?:\d{2}:\d{2}\s*del\s*)?(\d{2}\/\d{2}\/\d{4})/i);
  if (mDesde) {
    const p = mDesde[1].split('/');
    fechaInicio = `${p[2]}-${p[1]}-${p[0]}`;
  }

  const mHasta = fullSingleLineText.match(/Vigencia\s+hasta\s*:?\s*(?:\d{2}:\d{2}\s*del\s*)?(\d{2}\/\d{2}\/\d{4})/i);
  if (mHasta) {
    const p = mHasta[1].split('/');
    fechaVencimiento = `${p[2]}-${p[1]}-${p[0]}`;
  }

  let cobertura = '';
  const mCob = fullSingleLineText.match(/Cobertura\s*:?\s*([^\n]+?)(?=\s+Suma|\s+Premio|\s+Coberturas|\s+Plan|$)/i);
  if (mCob) cobertura = cleanText(mCob[1]);
  if (!cobertura || cobertura.length > 50) {
    if (/ROBO|HURTO/i.test(fullSingleLineText) && /INCENDIO/i.test(fullSingleLineText)) cobertura = 'Accidente, Incendio y Robo Total (C3)';
    else if (/TODO RIESGO/i.test(fullSingleLineText)) cobertura = 'Todo Riesgo con Franquicia';
    else cobertura = 'Responsabilidad Civil Básica';
  }

  let sumaAsegurada = 0;
  const mSuma = fullSingleLineText.match(/Suma\s+asegurada\s*:?\s*\$\s*([\d\.,]+)/i);
  if (mSuma) {
    sumaAsegurada = parseFloat(mSuma[1].replace(/\./g, '').replace(',', '.'));
  }

  let montoTotal = 0;
  const mTotal = fullSingleLineText.match(/(?:Saldo\s+en\s+cuotas|Premio|Total)\s*:?\s*\$\s*([\d\.,]+)/i);
  if (mTotal) {
    montoTotal = parseFloat(mTotal[1].replace(/\./g, '').replace(',', '.'));
  }

  let valorCuota = 0;
  const mCuota = fullSingleLineText.match(/(?:Cuota\s*\d*|Importe)\s*:?\s*\$\s*([\d\.,]+)/i);
  if (mCuota) {
    valorCuota = parseFloat(mCuota[1].replace(/\./g, '').replace(',', '.'));
  }

  let formaPago = 'debito_automatico';
  if (/DÉBITO AUTOMÁTICO|DEBITO AUTOMATICO/i.test(fullSingleLineText)) formaPago = 'debito_automatico';
  else if (/TARJETA/i.test(fullSingleLineText)) formaPago = 'tarjeta_credito';
  else if (/TRANSFERENCIA/i.test(fullSingleLineText)) formaPago = 'transferencia';
  else if (/EFECTIVO|COBRANZA/i.test(fullSingleLineText)) formaPago = 'efectivo';

  return {
    cliente: {
      nombre: nombreCliente || '',
      dni_cuit: dniCuit || '',
      direccion: direccion || '',
      localidad: localidad || '',
      provincia: provincia || 'Córdoba',
      telefono: telefono || ''
    },
    vehiculo: {
      patente: patente || '',
      marca: marca || '',
      modelo: modelo || '',
      version: version || '',
      anio: anio || new Date().getFullYear(),
      chasis: chasis || '',
      motor: motor || '',
      uso: uso
    },
    poliza: {
      numero_poliza: numeroPoliza || '',
      compania: compania !== 'Desconocida' ? compania : 'El Norte Seguros',
      fecha_inicio: fechaInicio || new Date().toISOString().split('T')[0],
      fecha_vencimiento: fechaVencimiento || new Date(Date.now() + 120*86400000).toISOString().split('T')[0],
      cobertura: cobertura || 'Accidente, Incendio y Robo Total',
      monto_total: montoTotal || 0,
      valor_cuota: valorCuota || 0,
      forma_pago: formaPago,
      suma_asegurada: sumaAsegurada || 0
    }
  };
}

module.exports = { parsePolicyPdfBuffer };
