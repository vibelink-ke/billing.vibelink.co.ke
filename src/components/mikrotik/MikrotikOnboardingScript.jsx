import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Download, Terminal, AlertCircle, Settings2, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { vibelink } from '@/api/vibelinkClient';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';

export default function MikrotikOnboardingScript({ open, onOpenChange, router }) {
  const [formData, setFormData] = useState({
    router_name: '',
    ip_address: '',
    api_username: 'vibelink-api',
    api_password: Math.random().toString(36).slice(-10),
    bandwidth_limit: '1000',
    vpn_enabled: true,
    vpn_protocol: 'wireguard',
    assigned_inner_ip: '10.8.0.' + (Math.floor(Math.random() * 253) + 2)
  });

  const [generatedScript, setGeneratedScript] = useState('');
  const [step, setStep] = useState(1); // 1: Config, 2: Script
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle, success, error
  const queryClient = useQueryClient();
  
  const { data: vpnConfigs = [] } = useQuery({
    queryKey: ['vpnConfigs'],
    queryFn: () => vibelink.entities.VPNConfig.list(),
  });

  const serverConfig = vpnConfigs.find(c => c.type === 'server');

  useEffect(() => {
    if (open && !router) {
      // Auto-generate values for new registrations
      const randomId = Math.random().toString(36).slice(-4).toUpperCase();
      setFormData({
        router_name: `Router-${randomId}`,
        ip_address: '',
        api_username: `vibelink-mgmt-${randomId.toLowerCase()}`,
        api_password: Math.random().toString(36).slice(-12),
        bandwidth_limit: '1000',
        vpn_enabled: true,
        vpn_protocol: 'wireguard',
        assigned_inner_ip: '10.8.0.' + (Math.floor(Math.random() * 253) + 2)
      });
      setStep(1);
      setShowAdvanced(false);
      setSaveStatus('idle');
    } else if (router) {
      setFormData({
        router_name: router.router_name || '',
        ip_address: router.ip_address || '',
        api_username: router.username || 'vibelink-api',
        api_password: router.password || Math.random().toString(36).slice(-10),
        bandwidth_limit: router.bandwidth_limit?.toString() || '1000',
        vpn_enabled: router.vpn_enabled ?? true,
        vpn_protocol: router.vpn_protocol || 'wireguard',
        assigned_inner_ip: router.assigned_inner_ip || '10.8.0.' + (Math.floor(Math.random() * 253) + 2)
      });
      setStep(1);
      setSaveStatus('idle');
    }
  }, [router, open]);

  const generateScript = (data) => {
    const date = new Date().toISOString().split('T')[0];
    const appUrl = window.location.origin;
    const routerId = data.id || 'PENDING_REGISTRATION';

    return `# VIBELINK - Auto-Onboarding Script
# Router: ${data.router_name}
# Generated: ${date}

# 1. Create API user
/user add name="${data.api_username}" password="${data.api_password}" group=full comment="Vibelink Management API"

# 2. Configure IP and basic networking
/ip address add address=${data.ip_address}/24 interface=ether1 comment="WAN IP"
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1 comment="Default NAT"

# 3. Bandwidth Management
/queue simple add name="${data.router_name}-bw" max-limit=${data.bandwidth_limit}M/${data.bandwidth_limit}M target=0.0.0.0/0

# 4. VPN Client Setup
${data.vpn_enabled && data.vpn_protocol === 'wireguard' && serverConfig ? `
/interface wireguard add name=wg-vibelink comment="Vibelink Management Tunnel"
/interface wireguard peers add interface=wg-vibelink public-key="${serverConfig.public_key}" endpoint-address=${serverConfig.public_endpoint} endpoint-port=${serverConfig.port} allowed-address=${serverConfig.allowed_ips || '0.0.0.0/0'} persistent-keepalive=25s
/ip address add address=${data.assigned_inner_ip || '10.8.0.x'}/24 interface=wg-vibelink comment="Management IP"
` : data.vpn_enabled ? `
/interface ${data.vpn_protocol} add name=vpn-vibelink comment="Vibelink Management Tunnel"
# Manual configuration required for ${data.vpn_protocol}
` : '# VPN disabled'}

# 5. Heartbeat / Auto-registration
/system scheduler add name=vibelink-heartbeat interval=5m \\
  on-event="/tool fetch url=\\"${appUrl}/api/heartbeat?router=${routerId}\\" keep-result=no"
`;
  };

  const createMutation = useMutation({
    mutationFn: (data) => vibelink.entities.Mikrotik.create({
      router_name: data.router_name,
      ip_address: data.ip_address,
      username: data.api_username,
      password: data.api_password,
      bandwidth_limit: parseInt(data.bandwidth_limit),
      vpn_enabled: data.vpn_enabled,
      vpn_protocol: data.vpn_protocol,
      assigned_inner_ip: data.assigned_inner_ip,
      status: 'pending'
    }),
    onSuccess: (newRouter) => {
      queryClient.invalidateQueries({ queryKey: ['mikrotiks'] });
      // Use any to avoid lint errors with mock return types
      const routerData = newRouter; 
      setGeneratedScript(generateScript({ ...formData, id: routerData?.id }));
      setSaveStatus('success');
      toast.success('Router record saved to dashboard');
    },
    onError: () => {
      setSaveStatus('error');
      // Still allow the script to be used even if save fails
      toast.error('Could not save router to dashboard, but you can still use the script.');
    }
  });

  const handleGenerate = () => {
    if (!formData.router_name) {
      toast.error('Router Identity Name is mandatory');
      return;
    }

    // Always generate and show script first to be responsive
    setGeneratedScript(generateScript(formData));
    setStep(2);
    
    // Attempt background save if it's a new router
    if (!router?.id) {
      setSaveStatus('idle');
      createMutation.mutate(formData);
    } else {
      setSaveStatus('success'); // Already exists
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedScript);
    toast.success('Script copied to clipboard');
  };

  const downloadScript = () => {
    const element = document.createElement('a');
    const file = new Blob([generatedScript], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `onboard-${formData.router_name.replace(/\s+/g, '_')}.rsc`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="">
          <DialogTitle className="">MikroTik Auto-Onboarding Script</DialogTitle>
          <DialogDescription className="">
            Generate a RouterOS script to automatically configure your device.
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-6 py-4">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl p-5 flex items-start gap-4">
              <div className="bg-white dark:bg-slate-800 p-2.5 rounded-lg shadow-sm border border-indigo-100 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100 italic">Zero-Touch Onboarding</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Enter only the router's current local IP address if known. Vibelink's WireGuard hub supports traversal even from behind a NAT or from routers without a public IP.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-2">
                    Router Identity Name *
                  </Label>
                  <Input
                    className="h-12 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all font-bold"
                    value={formData.router_name}
                    onChange={(e) => setFormData({ ...formData, router_name: e.target.value })}
                    placeholder="e.g. Branch-Nairobi-01"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-2">
                    WAN / Local IP (Optional)
                  </Label>
                  <Input
                    className="h-12 text-lg font-mono tracking-tight bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={formData.ip_address}
                    onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                    placeholder="e.g. 192.168.1.1"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 italic">WireGuard hub enables secure connection even from behind a NAT - a public IP for the router is NOT required.</p>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                <button 
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
                >
                  <Settings2 className="w-4 h-4" />
                  {showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showAdvanced && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }} 
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-6 py-4 overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-slate-500">Bandwidth (Mbps)</Label>
                        <Input
                          type="number"
                          value={formData.bandwidth_limit}
                          onChange={(e) => setFormData({ ...formData, bandwidth_limit: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-slate-500">VPN Management IP</Label>
                        <Input
                          value={formData.assigned_inner_ip}
                          onChange={(e) => setFormData({ ...formData, assigned_inner_ip: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-slate-500">API Username</Label>
                        <Input
                          value={formData.api_username}
                          onChange={(e) => setFormData({ ...formData, api_username: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-slate-500">API Password</Label>
                        <Input
                          type="password"
                          value={formData.api_password}
                          onChange={(e) => setFormData({ ...formData, api_password: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-slate-500">VPN Protocol</Label>
                        <Select
                          value={formData.vpn_protocol}
                          onValueChange={(v) => setFormData({ ...formData, vpn_protocol: v })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="wireguard">WireGuard (Recommended)</SelectItem>
                            <SelectItem value="pptp">PPTP (Legacy)</SelectItem>
                            <SelectItem value="l2tp">L2TP/IPSec</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wider text-slate-500">VPN Management IP</Label>
                        <Input
                          value={formData.assigned_inner_ip}
                          onChange={(e) => setFormData({ ...formData, assigned_inner_ip: e.target.value })}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            <DialogFooter className="border-t border-slate-100 dark:border-slate-800 pt-6">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button 
                onClick={handleGenerate} 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 h-12 rounded-xl shadow-lg shadow-indigo-600/20"
              >
                {createMutation.isPending ? 'Provisioning...' : 'Generate Onboarding Script'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {saveStatus === 'error' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>Note: Failed to save router to dashboard (API Error), but the script below is still valid.</span>
              </div>
            )}

            <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-slate-100 overflow-x-auto relative group">
              <pre className="whitespace-pre-wrap">{generatedScript}</pre>
              <Button 
                onClick={copyToClipboard} 
                size="sm" 
                variant="secondary" 
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Copy className="w-4 h-4 mr-2" /> Copy
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button onClick={copyToClipboard} variant="secondary" className="flex-1">
                <Copy className="w-4 h-4 mr-2" /> Copy Script
              </Button>
              <Button onClick={downloadScript} variant="secondary" className="flex-1">
                <Download className="w-4 h-4 mr-2" /> Download .rsc
              </Button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 flex gap-3">
              <div className="shrink-0 pt-1"><Terminal className="w-4 h-4" /></div>
              <div>
                <p className="font-semibold">How to apply:</p>
                <ol className="list-decimal list-inside space-y-1 mt-1">
                  <li>Open MikroTik WinBox or WebFig</li>
                  <li>Go to <strong>System</strong> -&gt; <strong>Scripts</strong> or open <strong>New Terminal</strong></li>
                  <li>Paste the script content above into the terminal and press Enter</li>
                  <li>The router will configure itself and connect back to this app</li>
                </ol>
              </div>
            </div>

            <DialogFooter className="">
              <Button variant="outline" onClick={() => setStep(1)}>Go Back</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
