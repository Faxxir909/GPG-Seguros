const db = require('../db');
const XLSX = require('xlsx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Helper para traer datos para reportes
async function getReportData(type) {
  switch (type) {
    case 'clients':
      return await db.all("SELECT nombre, dni_cuit, telefono, email, localidad, estado, riesgo_baja FROM clientes ORDER BY nombre ASC");
    case 'policies':
      return await db.all(`
        SELECT p.numero_poliza, p.compania, p.cobertura, p.estado, p.monto_total, p.valor_cuota, p.fecha_inicio, p.fecha_vencimiento, c.nombre as cliente
        FROM polizas p
        JOIN clientes c ON p.cliente_id = c.id
        ORDER BY p.fecha_vencimiento ASC
      `);
    case 'commissions':
      return await db.all(`
        SELECT com.compania, com.monto_poliza, com.tasa_comision, com.monto_comision, com.estado_pago, com.periodo, c.nombre as cliente, p.numero_poliza
        FROM comisiones com
        JOIN polizas p ON com.poliza_id = p.id
        JOIN clientes c ON p.cliente_id = c.id
        ORDER BY com.periodo DESC
      `);
    case 'claims':
      return await db.all(`
        SELECT s.numero_siniestro, s.fecha, s.descripcion, s.estado, c.nombre as cliente, v.patente
        FROM siniestros s
        JOIN clientes c ON s.cliente_id = c.id
        LEFT JOIN vehiculos v ON s.vehiculo_id = v.id
        ORDER BY s.fecha DESC
      `);
    default:
      return [];
  }
}

async function exportExcel(req, res, next) {
  const { type } = req.query;
  try {
    const data = await getReportData(type);
    if (!data.length) {
      const error = new Error('No hay datos para exportar.');
      error.status = 400;
      return next(error);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=reporte_${type}_${Date.now()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

async function exportPdf(req, res, next) {
  const { type } = req.query;
  try {
    const data = await getReportData(type);
    if (!data.length) {
      const error = new Error('No hay datos para exportar.');
      error.status = 400;
      return next(error);
    }

    // Crear PDF
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([600, 800]);
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Encabezado
    page.drawText('GPG Seguros - Reporte Comercial', { x: 50, y: height - 50, size: 20, font: fontBold, color: rgb(0.12, 0.23, 0.43) });
    page.drawText(`Reporte de: ${type.toUpperCase()}`, { x: 50, y: height - 75, size: 12, font: font });
    page.drawText(`Fecha de generación: ${new Date().toLocaleDateString()}`, { x: 50, y: height - 90, size: 10, font: font });

    // Dibujar línea separadora
    page.drawLine({
      start: { x: 50, y: height - 105 },
      end: { x: width - 50, y: height - 105 },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7)
    });

    let currentY = height - 130;
    const itemHeight = 25;

    // Dibujar encabezados de tabla según el tipo
    let headers = [];
    let keys = [];
    if (type === 'clients') {
      headers = ['Nombre', 'DNI/CUIT', 'Telefono', 'Localidad', 'Estado'];
      keys = ['nombre', 'dni_cuit', 'telefono', 'localidad', 'estado'];
    } else if (type === 'policies') {
      headers = ['Cliente', 'Poliza', 'Compania', 'Vence', 'Total'];
      keys = ['cliente', 'numero_poliza', 'compania', 'fecha_vencimiento', 'monto_total'];
    } else if (type === 'commissions') {
      headers = ['Poliza', 'Compania', 'Periodo', 'Comision', 'Estado'];
      keys = ['numero_poliza', 'compania', 'periodo', 'monto_comision', 'estado_pago'];
    } else if (type === 'claims') {
      headers = ['Nº Siniestro', 'Cliente', 'Fecha', 'Estado', 'Detalle'];
      keys = ['numero_siniestro', 'cliente', 'fecha', 'estado', 'descripcion'];
    }

    // Dibujar fila de cabecera
    let colWidth = (width - 100) / headers.length;
    headers.forEach((h, idx) => {
      page.drawText(h, { x: 50 + (idx * colWidth), y: currentY, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    });
    
    page.drawLine({
      start: { x: 50, y: currentY - 5 },
      end: { x: width - 50, y: currentY - 5 },
      thickness: 0.8,
      color: rgb(0.4, 0.4, 0.4)
    });
    currentY -= itemHeight;

    // Listar filas
    data.forEach((row, rowIdx) => {
      if (currentY < 50) {
        page = pdfDoc.addPage([600, 800]);
        currentY = height - 50;
        headers.forEach((h, idx) => {
          page.drawText(h, { x: 50 + (idx * colWidth), y: currentY, size: 10, font: fontBold });
        });
        currentY -= itemHeight;
      }

      keys.forEach((key, idx) => {
        let val = String(row[key] !== undefined ? row[key] : '');
        if (val.length > 20) val = val.substring(0, 17) + '...';
        page.drawText(val, { x: 50 + (idx * colWidth), y: currentY, size: 9, font: font });
      });

      page.drawLine({
        start: { x: 50, y: currentY - 5 },
        end: { x: width - 50, y: currentY - 5 },
        thickness: 0.3,
        color: rgb(0.8, 0.8, 0.8)
      });
      currentY -= itemHeight;
    });

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Disposition', `attachment; filename=reporte_${type}_${Date.now()}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportExcel,
  exportPdf
};
