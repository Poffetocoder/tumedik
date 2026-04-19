const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const LIMITES = {
  prueba: 2,
  personal: 30,
  familiar: 100
};

const COSTO_POR_ANALISIS = 0.02;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://tumedik.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const { fileBase64, fileType, edad, sexo, contexto, usuarioId } = JSON.parse(event.body);

    // Verificar usuario y plan
    const { data: usuario, error: userError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', usuarioId)
      .single();

    if (userError || !usuario) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Usuario no encontrado' }) };
    }

    const limite = LIMITES[usuario.plan] || 2;
    const esRenovable = usuario.plan !== 'prueba';

    // Resetear contador mensual si corresponde (solo planes pagos)
    if (esRenovable && new Date() >= new Date(usuario.fecha_reset_mes)) {
      await supabase.from('usuarios').update({
        examenes_usados_mes: 0,
        fecha_reset_mes: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
      }).eq('id', usuarioId);
      usuario.examenes_usados_mes = 0;
    }

    // Verificar límite
    if (usuario.examenes_usados_mes >= limite) {
      const mensaje = usuario.plan === 'prueba'
        ? 'Has usado tus 2 análisis de prueba. Suscríbete para continuar.'
        : `Has alcanzado tu límite de ${limite} análisis este mes.`;
      return { statusCode: 403, headers, body: JSON.stringify({ error: mensaje, limite_alcanzado: true }) };
    }

    // Verificar presupuesto global para usuarios de prueba
    if (usuario.plan === 'prueba') {
      const { data: config } = await supabase
        .from('config_global')
        .select('*')
        .eq('id', 1)
        .single();

      if (!config.free_activo || config.free_consumed_usd >= config.free_budget_usd) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Las pruebas gratuitas están temporalmente agotadas. Suscríbete para continuar.', presupuesto_agotado: true }) };
      }
    }

    // Llamar a Anthropic
    const isPDF = fileType === 'application/pdf';
    const contentBlock = isPDF
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: fileType, data: fileBase64 } };

    const ctx = [edad ? `Edad: ${edad} años` : '', sexo ? `Sexo: ${sexo}` : '', contexto || ''].filter(Boolean).join('. ');

    const prompt = `Eres asistente de orientación médica. Analiza el examen.${ctx ? ' Contexto: ' + ctx + '.' : ''}
Responde ÚNICAMENTE con JSON válido sin texto adicional ni markdown.
{"tipo_examen":"string","urgencia":"verde|amarillo|rojo","urgencia_descripcion":"string","resumen":"string","indicadores":[{"nombre":"string","valor_numerico":number|null,"unidad":"string","valor":"string","rango_min":number|null,"rango_max":number|null,"rango_referencia":"string","estado":"normal|elevado|bajo|critico","explicacion":"string"}],"especialidades":["string"],"plan_accion":["string"]}
Incluye TODOS los indicadores. Si no es examen médico: {"error":"..."}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }]
      })
    });

    const data = await response.json();
    let raw = (data.content || []).map(b => b.text || '').join('').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const resultado = JSON.parse(raw);

    if (resultado.error) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: resultado.error }) };
    }

    // Actualizar contadores
    await supabase.from('usuarios').update({
      examenes_usados_mes: usuario.examenes_usados_mes + 1,
      examenes_totales: usuario.examenes_totales + 1
    }).eq('id', usuarioId);

    // Registrar análisis
    await supabase.from('analisis').insert({
      usuario_id: usuarioId,
      tipo_examen: resultado.tipo_examen,
      urgencia: resultado.urgencia,
      resultado: resultado,
      costo_usd: COSTO_POR_ANALISIS
    });

    // Actualizar presupuesto global si es prueba
    if (usuario.plan === 'prueba') {
      await supabase.rpc('incrementar_consumo_free', { monto: COSTO_POR_ANALISIS });
    }

    return { statusCode: 200, headers, body: JSON.stringify(resultado) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error interno: ' + err.message }) };
  }
};