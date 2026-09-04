import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { DesignSurface } from '@/components/design/DesignSurface';

export function LoginPage() {
  const { signIn, signInWithUsername } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { show } = useToast();
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const isAr = lang === 'ar';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'pin' && !/^\d{4,6}$/.test(pin)) {
      show(isAr ? 'رمز PIN يجب أن يتكون من 4 إلى 6 أرقام' : 'PIN must be 4 to 6 digits', 'error');
      return;
    }
    setLoading(true);
    try {
      const result = mode === 'pin' ? await signInWithUsername(username, pin) : await signIn(email, password);
      if (result.error) {
        const code = result.error.code;
        let msg: string;
        if (code === 'invalid_credentials') msg = t('invalidCredentials');
        else if (code === 'email_not_confirmed') msg = t('emailNotConfirmed');
        else if (code === 'user_not_found') msg = mode === 'pin' ? t('usernameNotFound') : t('userNotFound');
        else if (code === 'user_inactive') msg = t('userInactive');
        else if (code === 'user_locked') msg = t('userLocked');
        else if (code === 'over_request_rate_limit') msg = t('rateLimited');
        else if (code === 'email_address_invalid') msg = t('invalidCredentials');
        else msg = `${t('loginFailed')} ${result.error.message}`;
        show(msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <DesignSurface testId="login-surface">
      <div className="min-h-screen flex">
        <div className="hidden lg:flex lg:w-1/2 bg-slate-900 text-white relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-brand-500" />
          <div className="relative z-10 flex flex-col items-center justify-center w-full p-12">
            <div className="mb-6"><Logo variant="vertical" size={72} tone="white" tagline={isAr ? 'منصة إدارة الأعمال' : 'Business Management Platform'} /></div>
            <h1 className="text-3xl font-bold text-white text-center mb-3">{t('appName')}</h1>
            <p className="text-slate-300 text-center text-lg max-w-sm">{isAr ? 'منصة إدارة الأعمال المتكاملة لإدارة متجرك وفروعه بكفاءة' : 'The complete business management platform for your store and branches'}</p>
            <div className="grid grid-cols-3 gap-4 mt-10 w-full max-w-md">
              {[
                { label: isAr ? 'فواتير يومية' : 'Daily Invoices', value: '100+' },
                { label: isAr ? 'منتجات' : 'Products', value: '500+' },
                { label: isAr ? 'تقارير' : 'Reports', value: '15+' },
              ].map((stat) => (
                <div key={stat.label} className="text-center bg-slate-800/90 rounded-xl px-4 py-3 border border-slate-700">
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-6 bg-ui-page-alt dark:bg-navy-950 relative">
          <div className="absolute top-4 end-4 z-10">
            <button data-testid="login-language-toggle" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} className="px-4 py-2 rounded-xl bg-ui-surface dark:bg-navy-900 text-ui-muted text-sm font-medium shadow-sm border border-ui-border dark:border-navy-800 hover:bg-ui-page-alt dark:hover:bg-navy-800 transition-colors">{lang === 'ar' ? 'English' : 'العربية'}</button>
          </div>

          <div data-testid="login-panel" className="w-full max-w-md animate-fade-in">
            <div className="lg:hidden mb-8 flex justify-center"><Logo variant="horizontal" size={40} tone="navy" tagline={isAr ? 'منصة إدارة الأعمال' : 'Business Management Platform'} /></div>
            <div className="bg-ui-surface dark:bg-navy-900 rounded-3xl shadow-xl border border-ui-border dark:border-navy-800 p-8">
              <div className="mb-6"><h2 className="text-2xl font-bold text-ui-text dark:text-white">{isAr ? 'مرحباً بك' : 'Welcome back'}</h2><p className="text-sm text-ui-subtle dark:text-ui-subtle mt-1">{isAr ? 'سجّل دخولك للوصول إلى منصة Premier' : 'Sign in to access Premier'}</p></div>
              <div data-testid="login-mode-toggle" className="flex rounded-xl bg-ui-page-alt dark:bg-navy-800 p-1 mb-5">
                <button type="button" onClick={() => setMode('pin')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === 'pin' ? 'bg-ui-surface dark:bg-navy-700 text-brand-700 dark:text-gold-400 shadow-sm' : 'text-ui-subtle dark:text-ui-subtle hover:text-ui-text dark:hover:text-ui-text'}`}>{t('loginWithPin')}</button>
                <button type="button" onClick={() => setMode('password')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === 'password' ? 'bg-ui-surface dark:bg-navy-700 text-brand-700 dark:text-gold-400 shadow-sm' : 'text-ui-subtle dark:text-ui-subtle hover:text-ui-text dark:hover:text-ui-text'}`}>{t('loginWithEmail')}</button>
              </div>
              <form data-testid="login-form" onSubmit={handleSubmit} className="space-y-4">
                {mode === 'pin' ? <>
                  <Input id="login-username" label={t('username')} value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" placeholder={isAr ? 'اسم المستخدم أو البريد الإلكتروني' : 'Username or email'} />
                  <Input id="login-pin" label={t('pin')} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} required inputMode="numeric" maxLength={6} placeholder="••••••" />
                </> : <>
                  <Input id="login-email" label={t('email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="email@example.com" />
                  <Input id="login-password" label={t('password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" minLength={6} />
                </>}
                <Button data-testid="login-submit" type="submit" size="lg" className="w-full" disabled={loading}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{t('signIn')}<ArrowRight className="w-4 h-4" /></>}</Button>
              </form>
              <p className="mt-5 text-center text-sm text-ui-subtle dark:text-ui-subtle">{t('noAccount')}{' '}<Link to="/register" className="font-semibold text-brand-600 hover:underline dark:text-gold-400">{t('signUp')}</Link></p>
            </div>
          </div>
        </div>
      </div>
    </DesignSurface>
  );
}
