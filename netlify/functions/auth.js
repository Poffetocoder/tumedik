const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const { action, email, password } = JSON.parse(event.body);

    if (action === 'registro') {
      const { data, error } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true
      });
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: error.message }) };

      await supabase.from('usuarios').insert({
        id: data.user.id,
        email: email,
        plan: 'prueba',
        examenes_usados_mes: 0,
        examenes_totales: 0
      });

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, usuario: data.user }) };
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Email o contraseña incorrectos' }) };

      const { data: usuario } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return { statusCode: 200, headers, body: JSON.stringify({
        ok: true,
        token: data.session.access_token,
        usuario: { ...data.user, ...usuario }
      })};
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Accion no valida' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Error interno: ' + err.message }) };
  }
};