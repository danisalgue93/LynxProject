import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthModal } from '@/src/components/auth/AuthModal';

// ── external dependency mocks ────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@solana/wallet-adapter-react-ui', () => ({
  useWalletModal: () => ({ setVisible: vi.fn() }),
}));

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({ connected: false, publicKey: null, signMessage: undefined }),
}));

vi.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn(),
    register: vi.fn(),
    verifyEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    loginWithWallet: vi.fn(),
  }),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  defaultMode: 'login' as const,
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('AuthModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<AuthModal {...baseProps} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "Sign in" heading in login mode', () => {
    render(<AuthModal {...baseProps} />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('renders "Create account" heading in signup mode', () => {
    render(<AuthModal {...baseProps} defaultMode="signup" />);
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
  });

  it('renders "Recover password" heading in forgot mode', () => {
    render(<AuthModal {...baseProps} defaultMode="forgot" />);
    expect(screen.getByRole('heading', { name: 'Recover password' })).toBeInTheDocument();
  });

  it('renders "Change password" heading in change mode', () => {
    render(<AuthModal {...baseProps} defaultMode="change" />);
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<AuthModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the wallet sign-in button in login mode', () => {
    render(<AuthModal {...baseProps} />);
    expect(screen.getByText('Sign in with wallet')).toBeInTheDocument();
  });

  it('hides the wallet button in change-password mode', () => {
    render(<AuthModal {...baseProps} defaultMode="change" />);
    expect(screen.queryByText('Sign in with wallet')).not.toBeInTheDocument();
  });

  it('shows "Forgot password?" link in login mode', () => {
    render(<AuthModal {...baseProps} />);
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  it('shows "Create account" link in login mode', () => {
    render(<AuthModal {...baseProps} />);
    expect(screen.getByText('Create account')).toBeInTheDocument();
  });

  it('shows "Back to login" link in signup mode', () => {
    render(<AuthModal {...baseProps} defaultMode="signup" />);
    expect(screen.getByText('Back to login')).toBeInTheDocument();
  });

  it('renders email and password inputs in login mode', () => {
    render(<AuthModal {...baseProps} />);
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('renders only email input in forgot mode', () => {
    render(<AuthModal {...baseProps} defaultMode="forgot" />);
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });
});
