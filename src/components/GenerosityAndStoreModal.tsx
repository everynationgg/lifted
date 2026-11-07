import React, { useState, useEffect } from 'react';
import {
  Heart,
  BookOpen,
  Download,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  X,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  DigitalProduct,
  PurchaseEntitlement,
  DonationFrequency,
  StoreComplianceNotice,
} from '../types/store';
import { storeService } from '../services/storeService';
import { digitalDeliveryService, type CachedWorkbookContent } from '../services/digitalDeliveryService';
import { paymentRouter } from '../services/payment/PaymentRouter';
import { APP_CONFIG } from '../config';

interface GenerosityAndStoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GenerosityAndStoreModal: React.FC<GenerosityAndStoreModalProps> = ({
  isOpen,
  onClose,
}) => {
  // Navigation tabs: Giving vs Workbooks
  const [activeTab, setActiveTab] = useState<'giving' | 'workbooks'>('giving');
  const [currency, setCurrency] = useState<'USD' | 'PHP'>('USD');

  // Products & Entitlements State
  const [products, setProducts] = useState<DigitalProduct[]>([]);
  const [entitlements, setEntitlements] = useState<PurchaseEntitlement[]>([]);
  const [complianceNotice, setComplianceNotice] = useState<StoreComplianceNotice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Release Mode & Simulator Detection
  const isSimulatorActive = paymentRouter.isSimulatorMode() && !APP_CONFIG.isProduction;

  // Voluntary Giving State
  const [selectedDonation, setSelectedDonation] = useState<number>(25);
  const [customDonation, setCustomDonation] = useState('');
  const [donationFrequency, setDonationFrequency] = useState<DonationFrequency>('one_time');
  const [donationDesignation, setDonationDesignation] = useState('trauma_workbook_scholarships');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donationOutcome, setDonationOutcome] = useState<'succeeded' | 'failed' | 'cancelled'>('succeeded');
  const [donationSuccessReceipt, setDonationSuccessReceipt] = useState<{
    number: string;
    amount: string;
    receiptUrl?: string;
  } | null>(null);
  const [isProcessingDonation, setIsProcessingDonation] = useState(false);

  // Workbook Checkout State
  const [activeCheckoutProduct, setActiveCheckoutProduct] = useState<DigitalProduct | null>(null);
  const [checkoutOutcome, setCheckoutOutcome] = useState<
    'succeeded' | 'failed' | 'cancelled' | 'expired' | 'network_error' | 'delayed'
  >('succeeded');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutSuccessNotice, setCheckoutSuccessNotice] = useState<string | null>(null);

  // Download & Offline Reading State
  const [downloadingProductId, setDownloadingProductId] = useState<string | null>(null);
  const [activeReadingWorkbook, setActiveReadingWorkbook] = useState<CachedWorkbookContent | null>(null);
  const [downloadedProductIds, setDownloadedProductIds] = useState<Set<string>>(new Set());

  // Load catalog, entitlements, and compliance notice
  const refreshStoreData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [prods, userEnts] = await Promise.all([
        storeService.getProducts(),
        storeService.getUserEntitlements(),
      ]);
      setProducts(prods);
      setEntitlements(userEnts);
      setComplianceNotice(storeService.getComplianceNotice());

      const downloaded = new Set<string>();
      for (const p of prods) {
        if (digitalDeliveryService.getDownloadedWorkbook(p.id)) {
          downloaded.add(p.id);
        }
      }
      setDownloadedProductIds(downloaded);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to load resources.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    Promise.all([storeService.getProducts(), storeService.getUserEntitlements()])
      .then(([prods, userEnts]) => {
        if (!isMounted) return;
        setProducts(prods);
        setEntitlements(userEnts);
        setComplianceNotice(storeService.getComplianceNotice());

        const downloaded = new Set<string>();
        for (const p of prods) {
          if (digitalDeliveryService.getDownloadedWorkbook(p.id)) {
            downloaded.add(p.id);
          }
        }
        setDownloadedProductIds(downloaded);
      })
      .catch((err) => {
        if (isMounted) setErrorMessage((err as Error).message || 'Failed to load resources.');
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Helpers
  const isProductOwned = (productId: string) => {
    return entitlements.some((e) => e.productId === productId && e.status === 'active');
  };

  const getPriceForProduct = (product: DigitalProduct) => {
    const pricing = product.pricing.find((p) => p.currency === currency && p.isActive);
    if (!pricing) return '$0.00';
    if (currency === 'PHP') {
      return `₱${(pricing.amountCents / 100).toFixed(2)}`;
    }
    return `$${(pricing.amountCents / 100).toFixed(2)}`;
  };

  // Handlers
  const handleProcessDonation = async () => {
    if (!isSimulatorActive && complianceNotice && !complianceNotice.isPurchaseEnabled) {
      setErrorMessage(
        'Client Preview Mode: Online giving is disabled in this preview build. Payment gateways will be connected in release v1.1.'
      );
      return;
    }
    setIsProcessingDonation(true);
    setErrorMessage(null);
    try {
      const amountVal = customDonation ? parseFloat(customDonation) : selectedDonation;
      if (isNaN(amountVal) || amountVal <= 0) {
        throw new Error('Please enter a valid contribution amount.');
      }
      const amountCents = Math.round(amountVal * 100);

      const donation = await storeService.processDonation({
        amountCents,
        currency,
        frequency: donationFrequency,
        designation: donationDesignation,
        donorEmail: donorEmail.trim() || undefined,
        donorName: donorName.trim() || undefined,
        simulatedOutcome: donationOutcome,
      });

      if (donation.status === 'succeeded') {
        const symbol = currency === 'PHP' ? '₱' : '$';
        setDonationSuccessReceipt({
          number: donation.donationNumber,
          amount: `${symbol}${amountVal.toFixed(2)}`,
          receiptUrl: donation.receiptUrl,
        });
      } else {
        setErrorMessage(`Simulated transaction outcome: ${donation.status}`);
      }
    } catch (err) {
      setErrorMessage((err as Error).message || 'Donation could not be processed.');
    } finally {
      setIsProcessingDonation(false);
    }
  };

  const handleStartCheckout = (product: DigitalProduct) => {
    if (!isSimulatorActive && complianceNotice && !complianceNotice.isPurchaseEnabled) {
      setErrorMessage(
        'Client Preview Mode: Digital workbook in-app purchases will be enabled upon Google Play Store launch. Real payments are disabled in this preview.'
      );
      return;
    }
    setErrorMessage(null);
    setActiveCheckoutProduct(product);
  };

  const handleConfirmCheckout = async () => {
    if (!activeCheckoutProduct) return;
    setIsCheckingOut(true);
    setErrorMessage(null);
    try {
      // 1. Create authoritative order
      const order = await storeService.createOrder(activeCheckoutProduct.productCode, currency, {
        simulatedOutcome: checkoutOutcome,
      });

      // 2. Process checkout simulation
      const result = await storeService.processCheckout(order.id, {
        simulatedOutcome: checkoutOutcome,
      });

      if (result.status === 'succeeded' && result.entitlementGranted) {
        setCheckoutSuccessNotice(
          `Successfully purchased ${activeCheckoutProduct.title}! Your license has been granted.`
        );
        setActiveCheckoutProduct(null);
        await refreshStoreData();
      } else {
        setErrorMessage(
          `Checkout simulation completed with status: ${result.status.toUpperCase()}. No entitlement was granted.`
        );
        setActiveCheckoutProduct(null);
      }
    } catch (err) {
      setErrorMessage((err as Error).message || 'Checkout failed.');
      setActiveCheckoutProduct(null);
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleDownloadWorkbook = async (product: DigitalProduct) => {
    setDownloadingProductId(product.id);
    setErrorMessage(null);
    try {
      const cached = await storeService.downloadAndStoreWorkbook(
        product.id,
        product.productCode,
        product.title
      );
      setDownloadedProductIds((prev) => new Set(prev).add(product.id));
      setActiveReadingWorkbook(cached);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to download workbook.');
    } finally {
      setDownloadingProductId(null);
    }
  };

  const handleOpenOfflineWorkbook = (productId: string) => {
    const cached = digitalDeliveryService.getDownloadedWorkbook(productId);
    if (cached) {
      setActiveReadingWorkbook(cached);
    } else {
      setErrorMessage('Local file not found. Please re-download.');
    }
  };

  const handleRestorePurchases = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await refreshStoreData();
      setCheckoutSuccessNotice('Purchases restored successfully.');
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to restore purchases.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSimulateRefund = async (product: DigitalProduct) => {
    if (!window.confirm(`Simulate refund for "${product.title}"? This will revoke entitlement and delete local offline content.`)) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // Find order
      const userEnts = await storeService.getUserEntitlements();
      const ent = userEnts.find((e) => e.productId === product.id);
      if (ent?.orderId) {
        await storeService.refundOrder(ent.orderId, 'User requested sandbox refund');
      }
      digitalDeliveryService.revokeDownloadedWorkbook(product.id);
      setDownloadedProductIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
      await refreshStoreData();
      setCheckoutSuccessNotice(`Refund processed for ${product.title}. License revoked.`);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Refund simulation failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content"
        style={{
          maxWidth: 540,
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-modal)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--blue-powder)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Heart size={16} color="var(--blue-accent-dark)" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Generosity & Digital Store
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {isSimulatorActive ? 'Phase 11 Sandbox & Synthetic Transactions' : 'Digital Workbooks & Voluntary Support'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Currency & Platform Compliance Banner */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: 2, borderRadius: 6 }}>
            <button
              onClick={() => setCurrency('USD')}
              style={{
                border: 'none',
                background: currency === 'USD' ? '#FFFFFF' : 'transparent',
                color: 'var(--text-primary)',
                fontWeight: currency === 'USD' ? 700 : 500,
                fontSize: '0.75rem',
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              USD ($)
            </button>
            <button
              onClick={() => setCurrency('PHP')}
              style={{
                border: 'none',
                background: currency === 'PHP' ? '#FFFFFF' : 'transparent',
                color: 'var(--text-primary)',
                fontWeight: currency === 'PHP' ? 700 : 500,
                fontSize: '0.75rem',
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              PHP (₱)
            </button>
          </div>

          <button
            onClick={handleRestorePurchases}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '0.74rem',
              padding: '4px 8px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={12} />
            <span>Restore Purchases</span>
          </button>
        </div>

        {/* Compliance Notice */}
        {complianceNotice && (
          <div
            style={{
              background: 'var(--blue-light-sky)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              marginBottom: '14px',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <ShieldCheck size={16} color="var(--blue-accent-dark)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>
                {complianceNotice.noticeTitle}
              </strong>
              <span>{complianceNotice.noticeDescription}</span>
            </div>
          </div>
        )}

        {/* Notifications & Error Banners */}
        {errorMessage && (
          <div
            style={{
              background: '#FEE2E2',
              border: '1px solid #FCA5A5',
              color: '#991B1B',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {checkoutSuccessNotice && (
          <div
            style={{
              background: '#DCFCE7',
              border: '1px solid #86EFAC',
              color: '#166534',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              marginBottom: '12px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={16} />
            <span>{checkoutSuccessNotice}</span>
          </div>
        )}

        {/* Tab Selector */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-full)',
            padding: 4,
            marginBottom: '16px',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            id="tab-toggle-giving"
            onClick={() => setActiveTab('giving')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 600,
              border: 'none',
              background: activeTab === 'giving' ? '#FFFFFF' : 'transparent',
              color: 'var(--text-primary)',
              boxShadow: activeTab === 'giving' ? 'var(--shadow-subtle)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            💖 Voluntary Giving
          </button>
          <button
            id="tab-toggle-workbooks"
            onClick={() => setActiveTab('workbooks')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.82rem',
              fontWeight: 600,
              border: 'none',
              background: activeTab === 'workbooks' ? '#FFFFFF' : 'transparent',
              color: 'var(--text-primary)',
              boxShadow: activeTab === 'workbooks' ? 'var(--shadow-subtle)' : 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            📚 Digital Workbooks ({products.length})
          </button>
        </div>

        {/* TAB 1: VOLUNTARY GIVING */}
        {activeTab === 'giving' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <h3 style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                Partner in Healing & Renewal
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                LIFTED is provided in partnership with <strong>Every Nation GG</strong> to support individuals and
                families navigating mental wellness challenges and trauma recovery. Contributions are completely
                voluntary. No guilt, no pressure. Essential emotional support, crisis hotlines, prayer, and personal
                journals are always 100% free.
              </p>
            </div>

            {donationSuccessReceipt ? (
              <div
                style={{
                  background: 'var(--blue-light-sky)',
                  border: '1px solid var(--border-focus)',
                  borderRadius: 'var(--radius-md)',
                  padding: '18px',
                  textAlign: 'center',
                }}
              >
                <CheckCircle2 size={36} color="var(--blue-accent-dark)" style={{ margin: '0 auto 8px' }} />
                <h3 style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Thank You for Your Generous Heart!
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Simulated voluntary gift of <strong>{donationSuccessReceipt.amount}</strong> received.
                </p>
                <div
                  style={{
                    background: '#FFFFFF',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    margin: '12px auto 0',
                    maxWidth: 320,
                  }}
                >
                  Confirmation Ref: <code>{donationSuccessReceipt.number}</code>
                </div>
                <button
                  onClick={() => setDonationSuccessReceipt(null)}
                  style={{
                    marginTop: '12px',
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                  }}
                >
                  Give Another Gift
                </button>
              </div>
            ) : (
              <>
                {/* Designation */}
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                    Designation / Fund:
                  </label>
                  <select
                    value={donationDesignation}
                    onChange={(e) => setDonationDesignation(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.84rem',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="trauma_workbook_scholarships">Trauma Workbook Scholarships (Subsidized Access)</option>
                    <option value="crisis_ministry">Crisis & Pastoral Care Ministry</option>
                    <option value="general_healing_ministry">General Emotional Wellness Ministry</option>
                  </select>
                </div>

                {/* Frequency */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setDonationFrequency('one_time')}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: donationFrequency === 'one_time' ? '2px solid var(--blue-accent-dark)' : '1px solid var(--border-subtle)',
                      background: donationFrequency === 'one_time' ? 'var(--blue-powder)' : '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    One-Time Gift
                  </button>
                  <button
                    onClick={() => setDonationFrequency('monthly')}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: 6,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      border: donationFrequency === 'monthly' ? '2px solid var(--blue-accent-dark)' : '1px solid var(--border-subtle)',
                      background: donationFrequency === 'monthly' ? 'var(--blue-powder)' : '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    Monthly Partner
                  </button>
                </div>

                {/* Amount presets */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {(currency === 'USD' ? [10, 25, 50] : [500, 1000, 2500]).map((amt) => {
                    const isSelected = selectedDonation === amt && !customDonation;
                    const symbol = currency === 'PHP' ? '₱' : '$';
                    return (
                      <button
                        key={amt}
                        onClick={() => {
                          setSelectedDonation(amt);
                          setCustomDonation('');
                        }}
                        style={{
                          padding: '12px 8px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '2px solid var(--blue-accent-dark)' : '1px solid var(--border-subtle)',
                          background: isSelected ? 'var(--blue-powder)' : '#FFFFFF',
                          fontWeight: 700,
                          fontSize: '1rem',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        {symbol}{amt}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Amount */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Custom:
                  </span>
                  <input
                    type="number"
                    placeholder={`Other ${currency} amount`}
                    value={customDonation}
                    onChange={(e) => {
                      setCustomDonation(e.target.value);
                      if (e.target.value) setSelectedDonation(Number(e.target.value));
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.84rem',
                      background: '#FFFFFF',
                    }}
                  />
                </div>

                {/* Donor info (Optional) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={donorName}
                    onChange={(e) => setDonorName(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.8rem',
                      background: '#FFFFFF',
                    }}
                  />
                  <input
                    type="email"
                    placeholder="Email for receipt (optional)"
                    value={donorEmail}
                    onChange={(e) => setDonorEmail(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.8rem',
                      background: '#FFFFFF',
                    }}
                  />
                </div>

                {/* Sandbox Outcome Simulator Control */}
                {isSimulatorActive && (
                  <div
                    style={{
                      background: 'var(--bg-secondary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px dashed var(--border-subtle)',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      🧪 Sandbox Simulation Control:
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['succeeded', 'failed', 'cancelled'] as const).map((outcome) => (
                        <button
                          key={outcome}
                          onClick={() => setDonationOutcome(outcome)}
                          style={{
                            border: 'none',
                            background: donationOutcome === outcome ? 'var(--blue-accent-dark)' : '#FFFFFF',
                            color: donationOutcome === outcome ? '#FFFFFF' : 'var(--text-secondary)',
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            textTransform: 'capitalize',
                          }}
                        >
                          {outcome}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  id="btn-confirm-donation"
                  onClick={handleProcessDonation}
                  disabled={isProcessingDonation}
                  className="btn-primary"
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '0.92rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: isProcessingDonation ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Heart size={16} />
                  <span>
                    {isProcessingDonation
                      ? 'Processing...'
                      : isSimulatorActive
                      ? `Give ${currency === 'PHP' ? '₱' : '$'}${customDonation || selectedDonation} (Sandbox)`
                      : `Give ${currency === 'PHP' ? '₱' : '$'}${customDonation || selectedDonation} (Preview)`}
                  </span>
                </button>
              </>
            )}
          </div>
        )}

        {/* TAB 2: DIGITAL WORKBOOKS */}
        {activeTab === 'workbooks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              Comprehensive faith-based clinical trauma recovery guides, polyvagal grounding exercises, and guided grief
              journals. Purchases grant a perpetual personal license with offline access.
            </p>

            {isLoading && (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                Loading digital catalog and licenses...
              </div>
            )}

            {products.map((product) => {
              const owned = isProductOwned(product.id);
              const downloaded = downloadedProductIds.has(product.id);
              const isDownloading = downloadingProductId === product.id;
              const formattedPrice = getPriceForProduct(product);

              return (
                <div
                  key={product.id}
                  style={{
                    background: '#FFFFFF',
                    border: owned ? '2px solid var(--blue-accent-dark)' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    boxShadow: 'var(--shadow-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background: owned ? '#DCFCE7' : 'var(--blue-light-sky)',
                            color: owned ? '#166534' : 'var(--text-primary)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-full)',
                          }}
                        >
                          {owned ? '✓ OWNED' : 'DIGITAL WORKBOOK'}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          v{product.version}
                        </span>
                      </div>
                      <h4 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        {product.title}
                      </h4>
                      {product.subtitle && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2, marginBottom: 6 }}>
                          {product.subtitle}
                        </p>
                      )}
                    </div>
                    {!owned && (
                      <div style={{ textAlign: 'right', marginLeft: 8 }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {formattedPrice}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block' }}>
                          One-time
                        </span>
                      </div>
                    )}
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>
                    {product.description}
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.74rem',
                      color: 'var(--text-muted)',
                      borderTop: '1px solid var(--border-subtle)',
                      paddingTop: 8,
                    }}
                  >
                    <span>By {product.authorName}</span>
                    <span>{(product.fileSizeBytes / 1024 / 1024).toFixed(1)} MB PDF</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {!owned ? (
                      <button
                        onClick={() => handleStartCheckout(product)}
                        className="btn-primary"
                        style={{
                          flex: 1,
                          padding: '10px',
                          fontSize: '0.86rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <Sparkles size={14} />
                        <span>
                          {isSimulatorActive
                            ? `Purchase License (${formattedPrice})`
                            : `Preview Workbook (${formattedPrice})`}
                        </span>
                      </button>
                    ) : (
                      <>
                        {downloaded ? (
                          <button
                            onClick={() => handleOpenOfflineWorkbook(product.id)}
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--blue-accent-dark)',
                              color: '#FFFFFF',
                              border: 'none',
                              fontSize: '0.86rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                              cursor: 'pointer',
                            }}
                          >
                            <BookOpen size={15} />
                            <span>Read Offline</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDownloadWorkbook(product)}
                            disabled={isDownloading}
                            style={{
                              flex: 1,
                              padding: '10px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--blue-light-sky)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--blue-accent-dark)',
                              fontSize: '0.86rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6,
                              cursor: isDownloading ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <Download size={15} />
                            <span>{isDownloading ? 'Downloading...' : 'Download for Offline Reading'}</span>
                          </button>
                        )}
                        {isSimulatorActive && (
                          <button
                            onClick={() => handleSimulateRefund(product)}
                            title="Simulate refund for testing"
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--radius-md)',
                              background: 'transparent',
                              color: '#DC2626',
                              border: '1px solid #FCA5A5',
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                            }}
                          >
                            Simulate Refund
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CHECKOUT SIMULATION MODAL */}
        {activeCheckoutProduct && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 16,
            }}
            onClick={() => setActiveCheckoutProduct(null)}
          >
            <div
              style={{
                background: '#FFFFFF',
                maxWidth: 440,
                width: '100%',
                borderRadius: 'var(--radius-lg)',
                padding: '20px',
                boxShadow: 'var(--shadow-modal)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Synthetic Sandbox Checkout
                </h3>
                <button
                  onClick={() => setActiveCheckoutProduct(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <X size={18} />
                </button>
              </div>

              <div
                style={{
                  background: 'var(--blue-light-sky)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 14,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  {activeCheckoutProduct.title}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  Price: <strong>{getPriceForProduct(activeCheckoutProduct)}</strong> • Perpetual Personal License
                </div>
              </div>

              {/* Simulation outcome picker */}
              {isSimulatorActive && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>
                    Select Simulated Transaction Outcome:
                  </label>
                  <select
                    value={checkoutOutcome}
                    onChange={(e) =>
                      setCheckoutOutcome(
                        e.target.value as 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'network_error' | 'delayed'
                      )
                    }
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.84rem',
                      background: '#FFFFFF',
                    }}
                  >
                    <option value="succeeded">Succeeded (Grant Entitlement)</option>
                    <option value="failed">Failed (Card Declined Simulation)</option>
                    <option value="cancelled">Cancelled by User</option>
                    <option value="expired">Expired Checkout Session</option>
                    <option value="network_error">Network Interruption Simulation</option>
                    <option value="delayed">Delayed / Asynchronous Clearing</option>
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setActiveCheckoutProduct(null)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    fontSize: '0.86rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmCheckout}
                  disabled={isCheckingOut}
                  className="btn-primary"
                  style={{
                    flex: 1,
                    padding: '10px',
                    fontSize: '0.86rem',
                    cursor: isCheckingOut ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isCheckingOut ? 'Executing...' : 'Confirm Sandbox Purchase'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* INTERACTIVE OFFLINE WORKBOOK VIEWER MODAL */}
        {activeReadingWorkbook && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1100,
              padding: 16,
            }}
            onClick={() => setActiveReadingWorkbook(null)}
          >
            <div
              style={{
                background: '#FFFFFF',
                maxWidth: 580,
                maxHeight: '88vh',
                width: '100%',
                borderRadius: 'var(--radius-lg)',
                padding: '20px',
                overflowY: 'auto',
                boxShadow: 'var(--shadow-modal)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BookOpen size={18} color="var(--blue-accent-dark)" />
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    Offline Workbook Reader
                  </h3>
                </div>
                <button
                  onClick={() => setActiveReadingWorkbook(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <X size={18} />
                </button>
              </div>

              <div
                style={{
                  background: 'var(--blue-light-sky)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 16,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <h4 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {activeReadingWorkbook.productTitle}
                </h4>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Version {activeReadingWorkbook.version} • Offline Verified
                </div>
              </div>

              {/* Chapters */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {activeReadingWorkbook.sampleContent.chapters.map((ch, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: 14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h5 style={{ fontSize: '0.88rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                        {ch.title}
                      </h5>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {ch.readingMinutes} min read
                      </span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                      {ch.body}
                    </p>
                    {ch.groundingExercise && (
                      <div
                        style={{
                          background: 'var(--blue-powder)',
                          padding: '10px',
                          borderRadius: 6,
                          marginTop: 10,
                          fontSize: '0.78rem',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <strong>🌱 Somatic Practice:</strong> {ch.groundingExercise}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={() => setActiveReadingWorkbook(null)}
                style={{
                  width: '100%',
                  marginTop: 16,
                  padding: 10,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close Reader
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
