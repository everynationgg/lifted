import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GenerosityAndStoreModal } from '../GenerosityAndStoreModal';
import { paymentRouter } from '../../services/payment/PaymentRouter';

describe('Generosity & Store Integration (Phase 11 UI)', () => {
  beforeEach(() => {
    localStorage.clear();
    paymentRouter.setSimulatorMode(true);
    vi.restoreAllMocks();
  });

  it('renders modal when open and displays compliance notice and currency toggle', async () => {
    render(<GenerosityAndStoreModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('Generosity & Digital Store')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Synthetic Development Sandbox/i)).toBeInTheDocument();
    });
    expect(screen.getByText('USD ($)')).toBeInTheDocument();
    expect(screen.getByText('PHP (₱)')).toBeInTheDocument();
    expect(screen.getByText(/Voluntary Giving/i)).toBeInTheDocument();
  });

  it('toggles currency between USD and PHP', async () => {
    render(<GenerosityAndStoreModal isOpen={true} onClose={() => {}} />);

    // Switch to workbooks tab
    const workbooksTab = screen.getByRole('button', { name: /Digital Workbooks/i });
    fireEvent.click(workbooksTab);

    // Default USD price
    await waitFor(() => {
      expect(screen.getByText('$14.99')).toBeInTheDocument();
    });

    // Toggle to PHP
    const phpButton = screen.getByRole('button', { name: 'PHP (₱)' });
    fireEvent.click(phpButton);

    await waitFor(() => {
      expect(screen.getByText('₱799.00')).toBeInTheDocument();
    });
  });

  it('completes voluntary donation in sandbox simulator mode', async () => {
    render(<GenerosityAndStoreModal isOpen={true} onClose={() => {}} />);

    // In Giving tab, click preset $50
    const fiftyButton = screen.getByRole('button', { name: '$50' });
    fireEvent.click(fiftyButton);

    // Confirm sandbox gift
    const giveButton = screen.getByRole('button', { name: /Give \$50 \(Sandbox\)/i });
    fireEvent.click(giveButton);

    await waitFor(() => {
      expect(screen.getByText(/Thank You for Your Generous Heart!/i)).toBeInTheDocument();
      expect(screen.getByText(/Confirmation Ref:/i)).toBeInTheDocument();
    });
  });

  it('executes full digital workbook checkout, offline download, reading, and refund flow', async () => {
    render(<GenerosityAndStoreModal isOpen={true} onClose={() => {}} />);

    // 1. Switch to workbooks
    fireEvent.click(screen.getByRole('button', { name: /Digital Workbooks/i }));

    await waitFor(() => {
      expect(screen.getByText(/Restoring the Broken/i)).toBeInTheDocument();
    });

    // 2. Click Purchase License
    const purchaseButton = screen.getAllByRole('button', { name: /Purchase License/i })[0];
    fireEvent.click(purchaseButton);

    // 3. Confirm in Sandbox Checkout Modal
    await waitFor(() => {
      expect(screen.getByText('Synthetic Sandbox Checkout')).toBeInTheDocument();
    });

    const confirmButton = screen.getByRole('button', { name: 'Confirm Sandbox Purchase' });
    fireEvent.click(confirmButton);

    // 4. Verify item becomes OWNED and offers Download
    await waitFor(() => {
      expect(screen.getByText('✓ OWNED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Download for Offline Reading/i })).toBeInTheDocument();
    });

    // 5. Download workbook
    const downloadButton = screen.getByRole('button', { name: /Download for Offline Reading/i });
    fireEvent.click(downloadButton);

    // 6. Verify Offline Reader opens with Chapter content
    await waitFor(() => {
      expect(screen.getByText('Offline Workbook Reader')).toBeInTheDocument();
      expect(screen.getByText(/Chapter 1: The Biology of Trauma/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Somatic Practice:/i).length).toBeGreaterThanOrEqual(1);
    });

    // Close reader
    fireEvent.click(screen.getByRole('button', { name: 'Close Reader' }));

    // 7. Verify button now says "Read Offline"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Read Offline' })).toBeInTheDocument();
    });

    // 8. Simulate refund
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const refundButton = screen.getByRole('button', { name: 'Simulate Refund' });
    fireEvent.click(refundButton);

    // 9. Verify license revoked and purchase button restored
    await waitFor(() => {
      expect(screen.queryByText('✓ OWNED')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Purchase License/i })[0]).toBeInTheDocument();
    });
  });
});
