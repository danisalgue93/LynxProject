import React, { useState } from 'react';
import { Bell, Trophy, Coins, Info, CheckCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/src/lib/utils';

export type NotificationType = 'tournament_entry' | 'tournament_ended' | 'claimable' | 'system_info' | 'trade' | 'market_resolved';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

// Demo data for notifications
const DEMO_NOTIFICATIONS: Notification[] = [];

interface NotificationsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  setNotifications: (notifications: Notification[]) => void;
}

export function NotificationsPopover({ isOpen, onClose, notifications, setNotifications }: NotificationsPopoverProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const handleMarkRead = (id: string) => {
    setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const getIconForType = (type: NotificationType) => {
    switch (type) {
      case 'claimable':
        return <Coins className="w-4 h-4 text-[#00FFD1]" />;
      case 'tournament_ended':
      case 'tournament_entry':
        return <Trophy className="w-4 h-4 text-[#9945FF]" />;
      case 'system_info':
      default:
        return <Info className="w-4 h-4 text-[#3B82F6]" />;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed left-4 right-4 top-16 sm:absolute sm:inset-auto sm:top-12 sm:-right-2 md:-right-4 sm:w-[380px] bg-[#0D0D0E] border border-[#27272A] rounded-lg shadow-2xl z-50 flex flex-col max-h-[calc(100vh-80px)] sm:max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-[#27272A] flex items-center justify-between bg-[#141417]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">{t('notifications.title', 'Notifications')}</h3>
            {unreadCount > 0 && (
              <span className="bg-[#00FFD1] text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button 
              onClick={handleMarkAllRead}
              className="text-[10px] text-[#A1A1AA] hover:text-[#00FFD1] transition-colors font-semibold uppercase tracking-wider"
            >
              {t('notifications.markAllRead', 'Mark all read')}
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1 p-2">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-[#71717A] text-xs">
              {t('notifications.empty', 'No notifications')}
            </div>
          ) : (
            notifications.map((notification) => (
              <div 
                key={notification.id}
                onClick={() => handleMarkRead(notification.id)}
                className={cn(
                  "p-3 rounded-lg mb-1 flex items-start gap-3 cursor-pointer transition-colors relative group",
                  notification.read ? "hover:bg-[#18181B]" : "bg-[#18181B]/50 hover:bg-[#18181B]"
                )}
              >
                {!notification.read && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#00FFD1] rounded-r-full" />
                )}
                
                <div className={cn(
                  "mt-1 w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-lg",
                  notification.type === 'claimable' ? "bg-[#00FFD1]/10 border border-[#00FFD1]/20" :
                  notification.type === 'tournament_ended' || notification.type === 'tournament_entry' ? "bg-[#9945FF]/10 border border-[#9945FF]/20" :
                  "bg-[#3B82F6]/10 border border-[#3B82F6]/20"
                )}>
                  {getIconForType(notification.type)}
                </div>

                <div className="flex-1 pr-4">
                  <div className="flex justify-between items-start mb-1">
                    <h4 className={cn(
                      "text-xs font-bold",
                      notification.read ? "text-[#E4E4E7]" : "text-white"
                    )}>
                      {notification.title}
                    </h4>
                    <span className="text-[9px] text-[#71717A] whitespace-nowrap ml-2 font-mono">
                      {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(notification.timestamp)}
                    </span>
                  </div>
                  <p className={cn(
                    "text-[11px] leading-relaxed",
                    notification.read ? "text-[#A1A1AA]" : "text-[#D4D4D8]"
                  )}>
                    {notification.message}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
