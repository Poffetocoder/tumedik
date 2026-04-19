const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://tumedik.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const token = event.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'No autorizado' }) };
    }

    // Verificar token y obtener usuario
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token inválido' }) };
    }

    // Obtener datos del plan y consumo
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', user.id)
      .single();

    // Obtener estado del presupuesto global
    const { data: config } = await supabase
      .from('config_global')
      .select('free_activo, free_budget_usd, free_consumed_usd')
      .eq('id', 1)
      .single();

    const limites = { prueba: 2, personal: 30, familiar: 100 };
    const limite = limites[usuario.plan] || 2;
    const restantes = Math.max(0, limite - usuario.examenes_usados_mes);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: user.id,
        email: user.email,
        plan: usuario.plan,
        examenes_usados_mes: usuario.examenes_usados_mes,
        examenes_totales: usuario.examenes_totales,
        limite_mes: limite,
        restantes,
        fecha_reset: usuario.fecha_reset_mes,
        free_activo: config?.free_activo ?? true,
        free_disponible: (config?.free_budget_usd - config?.free_consumed_usd).toFixed(2)
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error interno: ' + err.message }) };
  }
};