import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';
