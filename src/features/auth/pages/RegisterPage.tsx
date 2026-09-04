import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ArrowRight, ShieldAlert } from 'lucide-react';
import * as api from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';

export function RegisterPage() {
  const { signIn } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { show } = useToast();
  const [storeName, setStoreName] = useState('');
  const [storeNameEn, setStoreNameEn] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationDisabled, setRegistrationDisabled] = useState(false);
  const [disabledMessage, setDisabledMessage] = useState('');
  const isAr = lang === 'ar';

  useEffect(() => {
    async function checkRegistrationStatus() {
      try {
        const { data } = await api.admin.canCreateNewUser();
        if (data && data.allowed === false) {
          setRegistrationDisabled(true);
          setDisabledMessage(
            data.message ||
              (isAr
                ? 'تم إيقاف إنشاء المستخدمين الجدد بواسطة Super Admin'
                : 'New user creation has been disabled by the system administrator.')
          );
        }
      } catch (err) {
        console.warn('Failed to check user registration status:', err);
      }
    }
    void checkRegistrationStatus();
  }, [isAr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registrationDisabled) {
      show(
        disabledMessage ||
          (isAr
            ? 'تم إيقاف إنشاء المستخدمين الجدد بواسطة Super Admin'
            : 'New user creation has been disabled by the system administrator.'),
        'error'
      );
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await api.subscriptions.registerTenant({
        p_store_name: storeName.trim(),
        p_store_name_en: storeNameEn.trim() || null,
        p_owner_name: ownerName.trim(),
        p_email: email.trim(),
        p_password: password,
        p_phone: phone.trim() || null,
        p_address: address.trim() || null,
      });

      if (error) {
        show(error.message, 'error');
        return;
      }

      const result = data as { success?: boolean; error?: string; message?: string } | null;
      if (!result?.success) {
        const code = result?.error;
        let msg = t('registrationFailed');
        if (code === 'USER_CREATION_DISABLED' || code === 'NEW_USER_CREATION_DISABLED') {
          msg = result?.message || (isAr ? 'تم إيقاف إنشاء المستخدمين الجدد بواسطة Super Admin' : 'New user creation has been disabled by the system administrator.');
        } else if (code === 'EMAIL_TAKEN') {
          msg = t('emailExists');
        } else if (code === 'WEAK_PASSWORD') {
          msg = t('weakPassword');
        } else if (code === 'INVALID_EMAIL') {
          msg = t('invalidEmail');
        }
        show(msg, 'error');
        return;
      }

      show(t('registrationSuccess'), 'success');
      const r = await signIn(email.trim(), password);
      if (r.error) show(`${t('loginFailed')} ${r.error.message}`, 'error');
    } catch {
      show(t('registrationFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-navy-900 via-navy-800 to-navy-950 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500" />
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-20 -right-20 w-96 h-96 bg-gold-500/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/5 rounded-full blur-2xl" />
        </div>
        <div className="relative z-10 flex flex-col items-center justify-center w-full p-12">
          <div className="mb-6">
            <Logo variant="vertical" size={72} tone="white" tagline={isAr ? 'منصة إدارة الأعمال' : 'Business Management Platform'} />
          </div>
          <h1 className="text-3xl font-bold text-white text-center mb-3">{t('appName')}</h1>
          <p className="text-ui-muted/80 text-center text-lg max-w-sm">
            {isAr
              ? 'منصة إدارة الأعمال المتكاملة للمنتجات والمخزون ونقاط البيع والمطبخ والمشتريات'
              : 'The complete enterprise business platform for products, inventory, POS, kitchen, and procurement'}
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 bg-ui-page-alt dark:bg-navy-950 relative">
        <div className="absolute top-4 end-4 z-10">
          <button
            onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
            className="px-4 py-2 rounded-xl bg-ui-surface dark:bg-navy-900 text-ui-muted text-sm font-medium shadow-sm border border-ui-border dark:border-navy-800 hover:bg-ui-page-alt dark:hover:bg-navy-800 transition-colors"
          >
            {lang === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>

        <div className="w-full max-w-md animate-fade-in">
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo variant="horizontal" size={40} tone="navy" tagline={isAr ? 'منصة إدارة الأعمال' : 'Business Management Platform'} />
          </div>

          <div className="bg-ui-surface dark:bg-navy-900 rounded-3xl shadow-xl border border-ui-border dark:border-navy-800 p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-ui-text dark:text-white">{t('signUp')}</h2>
              <p className="text-sm text-ui-subtle dark:text-ui-subtle mt-1">{t('registerSubtitle')}</p>
            </div>

            {registrationDisabled && (
              <div className="mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-3 text-amber-800 dark:text-amber-300">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">{isAr ? 'التسجيل معطّل حالياً' : 'Registration Currently Disabled'}</p>
                  <p className="mt-0.5 text-xs opacity-90">{disabledMessage}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label={t('storeName')}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
                disabled={registrationDisabled}
                placeholder={isAr ? 'اسم متجرك' : 'Your store name'}
              />
              <Input
                label={t('storeNameEn')}
                value={storeNameEn}
                onChange={(e) => setStoreNameEn(e.target.value)}
                disabled={registrationDisabled}
                placeholder="Store name (English)"
              />
              <Input
                label={t('ownerName')}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                required
                disabled={registrationDisabled}
                placeholder={isAr ? 'اسم المالك' : 'Owner name'}
              />
              <Input
                label={t('email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={registrationDisabled}
                placeholder="email@example.com"
              />
              <Input
                label={t('password')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={registrationDisabled}
                placeholder="••••••••"
                minLength={6}
              />
              <Input
                label={t('phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={registrationDisabled}
                placeholder={isAr ? 'رقم الهاتف' : 'Phone'}
              />
              <Input
                label={t('address')}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={registrationDisabled}
                placeholder={isAr ? 'العنوان' : 'Address'}
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading || registrationDisabled}
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    {t('createAccount')}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-ui-subtle dark:text-ui-subtle">
              {t('haveAccount')}{' '}
              <Link to="/login" className="font-semibold text-brand-600 hover:underline dark:text-gold-400">
                {t('signIn')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
