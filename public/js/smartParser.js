// =========================================================================
// smartParser.js — Carga Inteligente de Pólizas desde PDF y Alta Rápida
// =========================================================================

let currentSmartData = null;

async function processPdfFile(file) {
  if (!file || file.type !== 'application/pdf') {
    showToast('Por favor seleccione un archivo PDF válido.', 'warning');
    return;
  }

  const btnDrop = document.getElementById('smart-dropzone');
  const spinner = document.getElementById('smart-loading');
  const formWrap = document.getElementById('smart-form-preview');

  if (btnDrop) btnDrop.classList.add('d-none');
  if (spinner) spinner.classList.remove('d-none');
  if (formWrap) formWrap.classList.add('d-none');

  const formData = new FormData();
  formData.append('pdf', file);

  try {
    const res = await fetch('/api/policies/parse-pdf', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error al procesar PDF' }));
      throw new Error(err.error || 'Error al procesar PDF');
    }

    const data = await res.json();
    if (!data.success || !data.extracted) {
      throw new Error('No se pudo extraer información clara del PDF.');
    }

    currentSmartData = data.extracted;
    populateSmartPreview(data.extracted);

    if (spinner) spinner.classList.add('d-none');
    if (formWrap) formWrap.classList.remove('d-none');
    showToast('¡Póliza leída con éxito! Verifique los datos y confirme.', 'success');
  } catch (err) {
    if (spinner) spinner.classList.add('d-none');
    if (btnDrop) btnDrop.classList.remove('d-none');
    showToast('Error de lectura PDF: ' + err.message, 'danger');
  }
}

function populateSmartPreview(extracted) {
  const { cliente, vehiculo, poliza } = extracted;

  // Cliente
  document.getElementById('smart-cli-nombre').value = cliente.nombre || '';
  document.getElementById('smart-cli-doc').value = cliente.dni_cuit || '';
  document.getElementById('smart-cli-telefono').value = cliente.telefono || '';
  document.getElementById('smart-cli-direccion').value = cliente.direccion || '';
  document.getElementById('smart-cli-localidad').value = cliente.localidad || '';
  document.getElementById('smart-cli-provincia').value = cliente.provincia || 'Córdoba';

  // Vehículo
  document.getElementById('smart-veh-patente').value = vehiculo.patente || '';
  document.getElementById('smart-veh-marca').value = vehiculo.marca || '';
  document.getElementById('smart-veh-modelo').value = vehiculo.modelo || '';
  document.getElementById('smart-veh-version').value = vehiculo.version || '';
  document.getElementById('smart-veh-anio').value = vehiculo.anio || 2020;
  document.getElementById('smart-veh-chasis').value = vehiculo.chasis || '';
  document.getElementById('smart-veh-motor').value = vehiculo.motor || '';

  // Póliza
  document.getElementById('smart-pol-numero').value = poliza.numero_poliza || '';
  document.getElementById('smart-pol-compania').value = poliza.compania || 'El Norte Seguros';
  document.getElementById('smart-pol-inicio').value = poliza.fecha_inicio || '';
  document.getElementById('smart-pol-vencimiento').value = poliza.fecha_vencimiento || '';
  document.getElementById('smart-pol-cobertura').value = poliza.cobertura || '';
  document.getElementById('smart-pol-monto').value = poliza.monto_total || 0;
  document.getElementById('smart-pol-cuota').value = poliza.valor_cuota || 0;
  document.getElementById('smart-pol-pago').value = poliza.forma_pago || 'debito_automatico';
}

async function submitSmartCreate() {
  if (!currentSmartData) return;

  const payload = {
    cliente: {
      nombre: document.getElementById('smart-cli-nombre').value.trim(),
      dni_cuit: document.getElementById('smart-cli-doc').value.trim(),
      telefono: document.getElementById('smart-cli-telefono').value.trim(),
      direccion: document.getElementById('smart-cli-direccion').value.trim(),
      localidad: document.getElementById('smart-cli-localidad').value.trim(),
      provincia: document.getElementById('smart-cli-provincia').value.trim()
    },
    vehiculo: {
      patente: document.getElementById('smart-veh-patente').value.trim(),
      marca: document.getElementById('smart-veh-marca').value.trim(),
      modelo: document.getElementById('smart-veh-modelo').value.trim(),
      version: document.getElementById('smart-veh-version').value.trim(),
      anio: document.getElementById('smart-veh-anio').value,
      chasis: document.getElementById('smart-veh-chasis').value.trim(),
      motor: document.getElementById('smart-veh-motor').value.trim()
    },
    poliza: {
      numero_poliza: document.getElementById('smart-pol-numero').value.trim(),
      compania: document.getElementById('smart-pol-compania').value.trim(),
      fecha_inicio: document.getElementById('smart-pol-inicio').value,
      fecha_vencimiento: document.getElementById('smart-pol-vencimiento').value,
      cobertura: document.getElementById('smart-pol-cobertura').value.trim(),
      monto_total: parseFloat(document.getElementById('smart-pol-monto').value),
      valor_cuota: parseFloat(document.getElementById('smart-pol-cuota').value),
      forma_pago: document.getElementById('smart-pol-pago').value
    }
  };

  try {
    const res = await apiFetch('/api/policies/smart-create', {
      method: 'POST',
      body: payload
    });

    bootstrap.Modal.getInstance(document.getElementById('modalCargaInteligente')).hide();
    showToast(res.message || '¡Póliza registrada exitosamente con Carga Inteligente!', 'success');
    
    // Recargar paneles activos
    if (typeof loadPoliciesList === 'function') loadPoliciesList();
    if (typeof loadClientsList === 'function') loadClientsList();
  } catch (err) {
    showToast('Error al registrar póliza: ' + err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Input PDF file change
  const fileInput = document.getElementById('smart-pdf-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        processPdfFile(e.target.files[0]);
      }
    });
  }

  // Drag & drop on dropzone
  const dropzone = document.getElementById('smart-dropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => { e.preventDefault(); dropzone.classList.add('border-primary', 'bg-light'); });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => { e.preventDefault(); dropzone.classList.remove('border-primary', 'bg-light'); });
    });
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files.length > 0) {
        processPdfFile(dt.files[0]);
      }
    });
  }

  // Submit Smart Create Form
  document.getElementById('formSmartCreate')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSmartCreate();
  });

  // Reset modal when opened
  const modalEl = document.getElementById('modalCargaInteligente');
  if (modalEl) {
    modalEl.addEventListener('show.bs.modal', () => {
      currentSmartData = null;
      document.getElementById('smart-dropzone')?.classList.remove('d-none');
      document.getElementById('smart-loading')?.classList.add('d-none');
      document.getElementById('smart-form-preview')?.classList.add('d-none');
      if (fileInput) fileInput.value = '';
    });
  }
});
