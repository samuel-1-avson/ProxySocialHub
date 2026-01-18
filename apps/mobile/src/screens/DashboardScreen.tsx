import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);

  const fetchData = async () => {
    try {
      // Parallel requests
      const [usageRes, walletRes] = await Promise.all([
        client.get('/usage/me').catch(e => ({ data: null })),
        client.get('/wallet').catch(e => ({ data: null }))
      ]);

      if (usageRes.data) setStats(usageRes.data);
      if (walletRes.data) setWallet(walletRes.data);
    } catch (error) {
      console.log('Error fetching dashboard data', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello, {user?.display_name || user?.email}</Text>
        <TouchableOpacity onPress={logout} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Wallet Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Wallet Balance</Text>
          <Text style={styles.balance}>
            {wallet ? `GHS ${wallet.balance.toFixed(2)}` : '...'}
          </Text>
          <Text style={styles.cardSub}>Available for withdrawal</Text>
        </View>

        {/* Usage Stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>My Usage</Text>
          <View style={styles.row}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{stats ? stats.total_gb.toFixed(2) : '0.00'}</Text>
              <Text style={styles.statLabel}>GB Used</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{stats ? `GHS ${stats.total_cost_ghs.toFixed(2)}` : '0.00'}</Text>
              <Text style={styles.statLabel}>Est. Cost</Text>
            </View>
          </View>
        </View>

        {/* Info */}
        <View style={[styles.card, styles.infoCard]}>
          <Text style={styles.infoText}>
            You are currently on the {user?.role} plan.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  greeting: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  logoutButton: {
    padding: 8,
  },
  logoutText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 10,
    fontWeight: '500',
  },
  balance: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  cardSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: '#E5F1FF',
    borderWidth: 1,
    borderColor: '#CCE4FF',
  },
  infoText: {
    color: '#0055AA',
    fontSize: 14,
  },
});
