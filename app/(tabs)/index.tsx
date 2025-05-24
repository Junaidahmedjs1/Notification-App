import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { db } from '@/app/config/firebase';
import { useAuth } from '@/app/context/AuthContext';
import { registerForPushNotificationsAsync, saveTokenToFirebase, sendPushNotification } from '@/app/utils/notifications';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

const { width, height } = Dimensions.get('window');

const scale = Math.min(width, height) / 375;
const normalize = (size: number) => Math.round(scale * size);

interface NotificationData {
  type?: string;
  senderId?: string;
  senderName?: string;
  timestamp?: string;
  messageTitle?: string;
  messageBody?: string;
}

interface UserNotification {
  title: string;
  body: string;
  senderName: string;
  timestamp: string;
  messageTitle?: string;
  read: boolean;
}

interface NotificationItem extends UserNotification {
  id: string;
}

interface UserNotificationCount {
  unreadCount: number;
  lastUpdated: string;
}

export default function HomeScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [focusedInput, setFocusedInput] = useState('');
  const { logOut, user, userProfile } = useAuth();
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const isAdmin = userProfile?.role === 'admin';

  // Update local unreadCount when notifications change
  useEffect(() => {
    const countUnread = notifications.filter(n => !n.read).length;
    setUnreadCount(countUnread);
  }, [notifications]);

  // Function to update notification count in Firestore (increment or set)
  const updateNotificationCount = async (userId: string, increment: number) => {
    try {
      const userCountRef = doc(db, 'userNotifications', userId);
      const docSnap = await getDoc(userCountRef);

      if (!docSnap.exists()) {
        // Create with initial unread count
        await setDoc(userCountRef, {
          unreadCount: increment,
          lastUpdated: new Date().toISOString()
        });
      } else {
        // Update unreadCount by increment (increment can be 0 to reset)
        if (increment === 0) {
          await updateDoc(userCountRef, {
            unreadCount: 0,
            lastUpdated: new Date().toISOString()
          });
        } else {
          const currentUnread = (docSnap.data()?.unreadCount ?? 0) + increment;
          await updateDoc(userCountRef, {
            unreadCount: currentUnread,
            lastUpdated: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error('Error updating notification count:', error);
    }
  };

  // Initialize unread count doc if not exists
  const initializeNotificationCount = async (userId: string) => {
    try {
      const userCountRef = doc(db, 'userNotifications', userId);
      const docSnap = await getDoc(userCountRef);

      if (!docSnap.exists()) {
        await setDoc(userCountRef, {
          unreadCount: 0,
          lastUpdated: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error initializing notification count:', error);
    }
  };

  useEffect(() => {
    if (!user) {
      router.replace('/auth/login');
      return;
    }

    const setupNotifications = async () => {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        setExpoPushToken(token);
        try {
          await saveTokenToFirebase(user.uid, token);
          await initializeNotificationCount(user.uid);
        } catch (error) {
          console.error('Error in setup:', error);
        }
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
          enableVibrate: true,
          enableLights: true,
          showBadge: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }

      // Get initial unread count from Firestore
      try {
        const userCountRef = doc(db, 'userNotifications', user.uid);
        const docSnap = await getDoc(userCountRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as UserNotificationCount;
          setGlobalUnreadCount(data.unreadCount);
          setUnreadCount(data.unreadCount);
          if (Platform.OS !== 'web') {
            await Notifications.setBadgeCountAsync(data.unreadCount);
          }
        }
      } catch (error) {
        console.error('Error getting initial count:', error);
      }

      // Set up notification listener for receiving notifications
      if (Platform.OS !== 'web') {
        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
          const notificationData = notification.request.content.data as NotificationData;
          const newNotification: NotificationItem = {
            id: Date.now().toString(),
            title: notification.request.content.title || 'New Message',
            body: notification.request.content.body || '',
            senderName: notificationData?.senderName || 'Unknown',
            timestamp: new Date().toLocaleString(),
            messageTitle: notificationData?.messageTitle,
            read: false
          };
          setNotifications(prev => [newNotification, ...prev]);
          setUnreadCount(prev => prev + 1);
        });
      }

      // Set up notification response listener
      responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
        console.log('Notification response:', response);
        setShowNotifications(true);
      });
    };

    setupNotifications();

    // Real-time listener for notification count updates from Firestore
    const unsubscribe = onSnapshot(doc(db, 'userNotifications', user.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as UserNotificationCount;
        setGlobalUnreadCount(data.unreadCount);
        setUnreadCount(data.unreadCount);
        if (Platform.OS !== 'web') {
          Notifications.setBadgeCountAsync(data.unreadCount).catch(console.error);
        }
      }
    });

    return () => {
      if (Platform.OS !== 'web') {
        if (notificationListener.current) {
          Notifications.removeNotificationSubscription(notificationListener.current);
        }
        if (responseListener.current) {
          Notifications.removeNotificationSubscription(responseListener.current);
        }
      }
      unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Listen to notifications for this user
    const unsubscribe = onSnapshot(
      collection(db, 'userNotifications', user.uid, 'notifications'),
      (snapshot) => {
        const notifs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as NotificationItem[];
        setNotifications(notifs.reverse()); // latest first
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleCloseNotifications = async () => {
    setShowNotifications(false);
    if (user) {
      await updateNotificationCount(user.uid, 0); // reset count to zero
      setUnreadCount(0);
      if (Platform.OS !== 'web') {
        await Notifications.setBadgeCountAsync(0);
      }
    }
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const handleLogout = async () => {
    try {
      await logOut();
      setNotifications([]); // Clear notifications on logout
      setUnreadCount(0); // Reset counter on logout
      router.replace('/auth/login');
    } catch (error: any) {
      console.error('Logout error:', error);
    }
  };

  if (!user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const handleSubmit = async () => {
    if (!isAdmin) {
      alert('Only administrators can send messages');
      return;
    }

    if (!title.trim() || !description.trim()) {
      alert('Please enter both title and description');
      return;
    }

    setIsSending(true);
    try {
      const tokensSnapshot = await getDocs(collection(db, 'userTokens'));
      const tokens = tokensSnapshot.docs
        .filter(doc => doc.id !== user?.uid) // Exclude admin's own token
        .map(doc => ({
          token: doc.data().token,
          userId: doc.id
        }))
        .filter(tokenData => tokenData.token); // Only valid tokens

      if (tokens.length === 0) {
        alert('No users found to send notifications to');
        setIsSending(false);
        return;
      }

      // Send push notifications and update recipient counts
      const sendPromises = tokens.map(async tokenData => {
        try {
          const notificationData = {
            type: 'message',
            senderId: user?.uid,
            senderName: userProfile?.username || user?.email,
            timestamp: new Date().toISOString(),
            messageTitle: title,
            messageBody: description
          };

          const result = await sendPushNotification(
            tokenData.token,
            title,
            description,
            notificationData
          );

          if (result) {
            await updateNotificationCount(tokenData.userId, 1); // increment unread count
            await addDoc(collection(db, 'userNotifications', tokenData.userId, 'notifications'), {
              title,
              body: description,
              senderName: userProfile?.username || user?.email,
              timestamp: new Date().toISOString(),
              messageTitle: title,
              read: false,
            });
            return { success: true, userId: tokenData.userId };
          }
          return { success: false, userId: tokenData.userId };
        } catch (error) {
          console.error('Error sending notification:', error);
          return { success: false, userId: tokenData.userId };
        }
      });

      const results = await Promise.all(sendPromises);
      const successfulSends = results.filter(r => r.success);

      if (successfulSends.length > 0) {
        // Add notification to admin's local list
        const newNotification: NotificationItem = {
          id: Date.now().toString(),
          title: 'Message Sent',
          body: `Your message "${title}" has been sent to ${successfulSends.length} users`,
          senderName: 'You',
          timestamp: new Date().toLocaleString(),
          messageTitle: title,
          read: false,
        };
        setNotifications(prev => [newNotification, ...prev]);

        setTitle('');
        setDescription('');
        alert(`Message sent successfully to ${successfulSends.length} users`);
      } else {
        alert('Failed to send message to any users');
      }

      // For web platform, add notification locally immediately
      if (Platform.OS === 'web') {
        const newNotification: NotificationItem = {
          id: Date.now().toString(),
          title,
          body: description,
          senderName: userProfile?.username || user?.email || 'Admin',
          timestamp: new Date().toLocaleString(),
          messageTitle: title,
          read: false
        };
        setNotifications(prev => [newNotification, ...prev]);
        setUnreadCount(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleNotification = () => {
    setShowNotifications(true);
  };

  return (
    <ThemedView style={styles.container}>
      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <ThemedText style={styles.welcomeText}>Welcome back, {userProfile?.username}!</ThemedText>
          </View>
          <TouchableOpacity onPress={handleNotification} style={styles.notificationIconContainer}>
            <Ionicons name="notifications-outline" size={32} color="#2563eb" />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <ThemedText style={styles.badgeText}>{unreadCount}</ThemedText>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <ThemedText style={styles.logoutText}>Logout</ThemedText>
        </TouchableOpacity>
      </View>

      {/* Notification Modal */}
      <Modal visible={showNotifications} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Notifications</ThemedText>
              <TouchableOpacity onPress={handleCloseNotifications}>
                <Ionicons name="close-circle" size={28} color="black" />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.notificationsList}>
              {notifications.length === 0 && (
                <ThemedText style={styles.noNotificationsText}>No notifications available.</ThemedText>
              )}
              {notifications.map((notification) => (
                <View key={notification.id} style={styles.notificationItem}>
                  <ThemedText style={styles.notificationTitle}>{notification.title}</ThemedText>
                  <ThemedText style={styles.notificationBody}>{notification.body}</ThemedText>
                  <ThemedText style={styles.notificationSender}>From: {notification.senderName}</ThemedText>
                  <ThemedText style={styles.notificationTimestamp}>{notification.timestamp}</ThemedText>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.clearButton} onPress={clearNotifications}>
              <ThemedText style={styles.clearButtonText}>Clear All</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Admin Panel */}
      {isAdmin && (
        <View style={styles.adminPanel}>
          <ThemedText style={styles.adminTitle}>Admin Panel - Send Push Notification</ThemedText>
          <TextInput
            placeholder="Title"
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            onFocus={() => setFocusedInput('title')}
            onBlur={() => setFocusedInput('')}
            editable={!isSending}
          />
          <TextInput
            placeholder="Description"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            style={[styles.input, styles.descriptionInput]}
            onFocus={() => setFocusedInput('description')}
            onBlur={() => setFocusedInput('')}
            editable={!isSending}
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSubmit} disabled={isSending}>
            {isSending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText style={styles.sendButtonText}>Send Notification</ThemedText>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 15,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
  },
  welcomeText: {
    fontSize: normalize(22),
    fontWeight: '600',
    color: '#2563eb',
  },
  notificationIconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    right: -8,
    top: -5,
    backgroundColor: '#f43f5e',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  logoutButton: {
    marginTop: 10,
    alignSelf: 'flex-end',
  },
  logoutText: {
    color: '#ef4444',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 10,
    maxHeight: height * 0.7,
    padding: 15,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: normalize(20),
    fontWeight: '700',
  },
  notificationsList: {
    marginTop: 15,
    maxHeight: height * 0.55,
  },
  noNotificationsText: {
    fontSize: normalize(16),
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 20,
  },
  notificationItem: {
    paddingVertical: 10,
    borderBottomColor: '#d1d5db',
    borderBottomWidth: 1,
  },
  notificationTitle: {
    fontWeight: '700',
    fontSize: normalize(16),
    color: '#2563eb',
  },
  notificationBody: {
    fontSize: normalize(14),
    marginTop: 2,
  },
  notificationSender: {
    fontSize: normalize(12),
    marginTop: 4,
    color: '#6b7280',
  },
  notificationTimestamp: {
    fontSize: normalize(12),
    color: '#9ca3af',
    marginTop: 2,
  },
  clearButton: {
    marginTop: 15,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#ef4444',
    borderRadius: 5,
  },
  clearButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  adminPanel: {
    marginTop: 30,
  },
  adminTitle: {
    fontSize: normalize(18),
    fontWeight: '700',
    marginBottom: 15,
    color: '#2563eb',
  },
  input: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: normalize(16),
    marginBottom: 15,
  },
  descriptionInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: normalize(16),
  },
});