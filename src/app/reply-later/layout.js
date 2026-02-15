import AuthWrapper from '@/components/AuthWrapper';

export default function Layout({ children }) {
  return <AuthWrapper>{children}</AuthWrapper>;
}
