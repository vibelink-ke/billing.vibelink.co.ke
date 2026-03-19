// worker.js - Cloudflare Worker API for VIBELINK
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Authentication ====================
    
    // Helper functions
    async function hashPassword(password) {
      const encoder = new TextEncoder();
      const data = encoder.encode(password + 'vibelink-secret-salt');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    async function verifyPassword(password, hash) {
      const inputHash = await hashPassword(password);
      return inputHash === hash;
    }
    
    async function generateJWT(payload, secret) {
      const header = { alg: 'HS256', typ: 'JWT' };
      const encodedHeader = btoa(JSON.stringify(header));
      const encodedPayload = btoa(JSON.stringify(payload));
      const data = `${encodedHeader}.${encodedPayload}`;
      const signature = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        ),
        new TextEncoder().encode(data)
      );
      const encodedSignature = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      return `${data}.${encodedSignature}`;
    }
    
    async function verifyJWT(token, secret) {
      try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        
        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const payload = JSON.parse(atob(encodedPayload));
        
        if (payload.exp && Date.now() > payload.exp * 1000) {
          return null;
        }
        
        const data = `${encodedHeader}.${encodedPayload}`;
        const signature = await crypto.subtle.sign(
          'HMAC',
          await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          ),
          new TextEncoder().encode(data)
        );
        
        const expectedSignature = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        if (expectedSignature !== encodedSignature) {
          return null;
        }
        
        return payload;
      } catch (e) {
        return null;
      }
    }
    
    // Register endpoint
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      const body = await request.json();
      
      if (!body.email || !body.password || !body.role) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: email, password, role' 
        }), { status: 400 });
      }
      
      const existingUser = await env.DB.prepare(
        'SELECT id FROM users WHERE email = ?'
      ).bind(body.email).first();
      
      if (existingUser) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'User already exists' 
        }), { status: 409 });
      }
      
      const passwordHash = await hashPassword(body.password);
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const result = await env.DB.prepare(
        'INSERT INTO users (id, email, password_hash, role, full_name, is_active) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        userId,
        body.email,
        passwordHash,
        body.role,
        body.full_name || body.email.split('@')[0],
        true
      ).run();
      
      if (!result.success) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Failed to create user' 
        }), { status: 500 });
      }
      
      const jwtSecret = env.JWT_SECRET || 'your-secret-key-change-in-production';
      const token = await generateJWT({
        sub: userId,
        email: body.email,
        role: body.role,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      }, jwtSecret);
      
      const response = new Response(JSON.stringify({ 
        success: true, 
        user: { id: userId, email: body.email, role: body.role },
        token
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
        }
      });
      
      return response;
    }
    
    // Login endpoint
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json();
      
      if (!body.email || !body.password) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Email and password are required' 
        }), { status: 400 });
      }
      
      const user = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind(body.email).first();
      
      if (!user) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid email or password' 
        }), { status: 401 });
      }
      
      if (!user.is_active) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Account is inactive' 
        }), { status: 403 });
      }
      
      const passwordHash = await hashPassword(body.password);
      if (user.password_hash !== passwordHash) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid email or password' 
        }), { status: 401 });
      }
      
      const jwtSecret = env.JWT_SECRET || 'your-secret-key-change-in-production';
      const token = await generateJWT({
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      }, jwtSecret);
      
      const response = new Response(JSON.stringify({ 
        success: true, 
        user: { 
          id: user.id, 
          email: user.email, 
          role: user.role,
          full_name: user.full_name
        },
        token
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
        }
      });
      
      return response;
    }
    
    // Get current user
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const authHeader = request.headers.get('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'No authorization token provided' 
        }), { status: 401 });
      }
      
      const token = authHeader.substring(7);
      const jwtSecret = env.JWT_SECRET || 'your-secret-key-change-in-production';
      const payload = await verifyJWT(token, jwtSecret);
      
      if (!payload) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid or expired token' 
        }), { status: 401 });
      }
      
      const user = await env.DB.prepare(
        'SELECT id, email, role, tenant_id, full_name, is_active, two_factor_enabled FROM users WHERE id = ?'
      ).bind(payload.sub).first();
      
      if (!user) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'User not found' 
        }), { status: 404 });
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        user 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Logout endpoint
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const response = new Response(JSON.stringify({ 
        success: true, 
        message: 'Logged out successfully' 
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': 'auth_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
        }
      });
      
      return response;
    }
    
    // Refresh token
    if (url.pathname === '/api/auth/refresh' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'No authorization token provided' 
        }), { status: 401 });
      }
      
      const token = authHeader.substring(7);
      const jwtSecret = env.JWT_SECRET || 'your-secret-key-change-in-production';
      const payload = await verifyJWT(token, jwtSecret);
      
      if (!payload) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid or expired token' 
        }), { status: 401 });
      }
      
      const user = await env.DB.prepare(
        'SELECT * FROM users WHERE id = ?'
      ).bind(payload.sub).first();
      
      if (!user || !user.is_active) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'User not found or inactive' 
        }), { status: 401 });
      }
      
      const newToken = await generateJWT({
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      }, jwtSecret);
      
      const response = new Response(JSON.stringify({ 
        success: true, 
        token: newToken 
      }), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Set-Cookie': `auth_token=${newToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
        }
      });
      
      return response;
    }
    
    // Update password
    if (url.pathname === '/api/auth/password' && request.method === 'PUT') {
      const authHeader = request.headers.get('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'No authorization token provided' 
        }), { status: 401 });
      }
      
      const token = authHeader.substring(7);
      const jwtSecret = env.JWT_SECRET || 'your-secret-key-change-in-production';
      const payload = await verifyJWT(token, jwtSecret);
      
      if (!payload) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid or expired token' 
        }), { status: 401 });
      }
      
      const body = await request.json();
      
      if (!body.current_password || !body.new_password) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Current password and new password are required' 
        }), { status: 400 });
      }
      
      const user = await env.DB.prepare(
        'SELECT * FROM users WHERE id = ?'
      ).bind(payload.sub).first();
      
      if (!user) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'User not found' 
        }), { status: 404 });
      }
      
      const passwordHash = await hashPassword(body.current_password);
      if (user.password_hash !== passwordHash) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Current password is incorrect' 
        }), { status: 401 });
      }
      
      const newPasswordHash = await hashPassword(body.new_password);
      await env.DB.prepare(
        'UPDATE users SET password_hash = ? WHERE id = ?'
      ).bind(newPasswordHash, payload.sub).run();
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Password updated successfully' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Users ====================
    
    if (url.pathname === '/api/users' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM users').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/users' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO users (id, email, password_hash, role, tenant_id, full_name) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.email,
        body.password_hash,
        body.role,
        body.tenant_id,
        body.full_name
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Customers ====================
    
    if (url.pathname === '/api/customers' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM customers').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/customers' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO customers (id, tenant_id, first_name, last_name, email, phone, address, city, country, postal_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.tenant_id,
        body.first_name,
        body.last_name,
        body.email,
        body.phone,
        body.address,
        body.city,
        body.country,
        body.postal_code
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Tenants ====================
    
    if (url.pathname === '/api/tenants' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM tenants').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/tenants' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO tenants (id, name, company_name, email, phone, address, city, country, billing_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.name,
        body.company_name,
        body.email,
        body.phone,
        body.address,
        body.city,
        body.country,
        body.billing_email
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Service Plans ====================
    
    if (url.pathname === '/api/service-plans' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM service_plans').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/service-plans' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO service_plans (id, tenant_id, name, description, price_per_month, bandwidth_limit, data_limit, speed_download, speed_upload, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.tenant_id,
        body.name,
        body.description,
        body.price_per_month,
        body.bandwidth_limit,
        body.data_limit,
        body.speed_download,
        body.speed_upload,
        body.features ? JSON.stringify(body.features) : '[]'
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Hotspots ====================
    
    if (url.pathname === '/api/hotspots' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM hotspots').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/hotspots' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO hotspots (id, tenant_id, name, location, description, mac_address) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.tenant_id,
        body.name,
        body.location,
        body.description,
        body.mac_address
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Tickets ====================
    
    if (url.pathname === '/api/tickets' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM tickets').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/tickets' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO tickets (id, tenant_id, customer_id, subject, description, priority, status, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.tenant_id,
        body.customer_id || null,
        body.subject,
        body.description,
        body.priority || 'medium',
        body.status || 'open',
        body.assigned_to || null
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Activity Logs ====================
    
    if (url.pathname === '/api/activity-logs' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    if (url.pathname === '/api/activity-logs' && request.method === 'POST') {
      const body = await request.json();
      const result = await env.DB.prepare(
        'INSERT INTO activity_logs (id, user_id, tenant_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        body.id,
        body.user_id || null,
        body.tenant_id || null,
        body.action,
        body.entity_type || null,
        body.entity_id || null,
        body.details || null,
        body.ip_address || null
      ).run();
      return new Response(JSON.stringify({ success: true, id: body.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Invoices ====================
    
    if (url.pathname === '/api/invoices' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM invoices').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Subscriptions ====================
    
    if (url.pathname === '/api/subscriptions' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM subscriptions').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // ==================== Mikrotik Devices ====================
    
    if (url.pathname === '/api/mikrotik-devices' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM mikrotik_devices').all();
      return new Response(JSON.stringify(result.results), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  },
};
