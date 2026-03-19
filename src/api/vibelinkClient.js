const API_BASE_URL = 'https://vibelink-api.your-account.workers.dev';

export const vibelink = {
  // Authentication
  async register(userData) {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    return response.json();
  },
  
  async login(credentials) {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    return response.json();
  },
  
  async getCurrentUser() {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async logout() {
    const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.json();
  },
  
  // CRUD Operations
  async getUsers() {
    const response = await fetch(`${API_BASE_URL}/api/users`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async createCustomer(customer) {
    const response = await fetch(`${API_BASE_URL}/api/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(customer)
    });
    return response.json();
  },
  
  async getTenants() {
    const response = await fetch(`${API_BASE_URL}/api/tenants`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async createTenant(tenant) {
    const response = await fetch(`${API_BASE_URL}/api/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(tenant)
    });
    return response.json();
  },
  
  async getServicePlans() {
    const response = await fetch(`${API_BASE_URL}/api/service-plans`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async createServicePlan(plan) {
    const response = await fetch(`${API_BASE_URL}/api/service-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(plan)
    });
    return response.json();
  },
  
  async getHotspots() {
    const response = await fetch(`${API_BASE_URL}/api/hotspots`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async createHotspot(hotspot) {
    const response = await fetch(`${API_BASE_URL}/api/hotspots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(hotspot)
    });
    return response.json();
  },
  
  async getTickets() {
    const response = await fetch(`${API_BASE_URL}/api/tickets`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async createTicket(ticket) {
    const response = await fetch(`${API_BASE_URL}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(ticket)
    });
    return response.json();
  },
  
  async getActivityLogs() {
    const response = await fetch(`${API_BASE_URL}/api/activity-logs`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    return response.json();
  },
  
  async createActivityLog(log) {
    const response = await fetch(`${API_BASE_URL}/api/activity-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify(log)
    });
    return response.json();
  },
  
  async health() {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.json();
  }
};

// Helper functions
function getAuthToken() {
  const cookies = document.cookie.split(';');
  const authCookie = cookies.find(c => c.trim().startsWith('auth_token='));
  if (authCookie) {
    return authCookie.split('=')[1];
  }
  return null;
}

function setAuthToken(token) {
  document.cookie = `auth_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}

function clearAuthToken() {
  document.cookie = 'auth_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

export { getAuthToken, setAuthToken, clearAuthToken };

