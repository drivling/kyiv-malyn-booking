import React from 'react';
import './Alert.css';

type AlertVariant = 'success' | 'error' | 'warning' | 'info';

interface AlertProps {
  variant: AlertVariant;
  children: React.ReactNode;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant,
  children,
  className = '',
}) => {
  return (
    <div className={`alert alert-${variant} ${className}`}>
      {children}
    </div>
  );
};
