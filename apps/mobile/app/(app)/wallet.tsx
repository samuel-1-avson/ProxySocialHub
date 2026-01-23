import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image, RefreshControl, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { Ionicons, FontAwesome5, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { getWallet, getTransactions, depositWallet, withdrawWallet, Wallet, WalletTransaction } from '../../src/api/wallet';
import { useAuth } from '../../src/context/AuthContext';

export default function WalletScreen() {
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    // Modal States
    const [depositModalVisible, setDepositModalVisible] = useState(false);
    const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);

    // Form States
    const [amount, setAmount] = useState('');
    const [phone, setPhone] = useState('');
    const [network, setNetwork] = useState('MTN'); // Default network
    const [processing, setProcessing] = useState(false);

    const fetchData = async () => {
        try {
            const [walletData, txData] = await Promise.all([
                getWallet(),
                getTransactions()
            ]);
            setWallet(walletData);
            setTransactions(txData.transactions || []);
        } catch (error) {
            console.error("Wallet Fetch Error:", error);
            // Alert.alert("Error", "Failed to load wallet data");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchData();
    }, []);

    const handleDeposit = async () => {
        if (!amount || isNaN(Number(amount))) {
            Alert.alert("Invalid Amount", "Please enter a valid amount");
            return;
        }
        setProcessing(true);
        try {
            const email = user?.email || "user@example.com";
            const res = await depositWallet(Number(amount), email);

            // Open Paystack URL
            if (res.authorization_url) {
                await WebBrowser.openBrowserAsync(res.authorization_url);
                // After returning, refresh wallet (could be improved with deep link verification)
                Alert.alert("Payment Initiated", "Check your mobile money / card to complete the transaction.");
                setDepositModalVisible(false);
                setAmount('');
                fetchData();
            }
        } catch (error: any) {
            Alert.alert("Deposit Failed", error.message || "Something went wrong");
        } finally {
            setProcessing(false);
        }
    };

    const handleWithdraw = async () => {
        if (!amount || isNaN(Number(amount))) {
            Alert.alert("Invalid Amount", "Please enter a valid amount");
            return;
        }
        if (!phone) {
            Alert.alert("Invalid Phone", "Please enter a phone number");
            return;
        }

        setProcessing(true);
        try {
            const res = await withdrawWallet(Number(amount), phone, network);
            Alert.alert("Success", `Withdrawal of GHS ${amount} initiated to ${network} ${phone}. Reference: ${res.reference}`);
            setWithdrawModalVisible(false);
            setAmount('');
            setPhone('');
            fetchData();
        } catch (error: any) {
            Alert.alert("Withdrawal Failed", error.message || "Insufficient funds or network error");
        } finally {
            setProcessing(false);
        }
    };


    const renderTransaction = ({ item }: { item: WalletTransaction }) => {
        const isCredit = item.type === 'deposit' || item.type === 'earning' || item.type === 'refund';
        return (
            <View style={styles.txCard}>
                <View style={[styles.txIcon, isCredit ? styles.bgGreen : styles.bgRed]}>
                    <Ionicons
                        name={isCredit ? "arrow-down-outline" : "arrow-up-outline"}
                        size={20}
                        color={isCredit ? "#059669" : "#DC2626"}
                    />
                </View>
                <View style={styles.txContent}>
                    <Text style={styles.txDesc}>{item.description || item.type.toUpperCase()}</Text>
                    <Text style={styles.txDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                </View>
                <Text style={[styles.txAmount, isCredit ? styles.textGreen : styles.textRed]}>
                    {isCredit ? '+' : '-'} GHS {item.amount.toFixed(2)}
                </Text>
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563EB" />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-background">
            <View
                className="absolute top-0 left-0 right-0 bg-primary/5 rounded-b-[40px]"
                style={{ height: 160 + insets.top }}
            />

            <View
                className="pb-6 px-6 flex-row justify-between items-center"
                style={{ paddingTop: insets.top + 20 }}
            >
                <View>
                    <View className="flex-row items-center mb-1">
                        <View className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                        <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Asset Terminal</Text>
                    </View>
                    <Text className="text-3xl font-black text-foreground uppercase tracking-tighter italic">
                        Financial<Text className="text-primary italic">_</Text>Core
                    </Text>
                </View>
                <TouchableOpacity
                    onPress={fetchData}
                    className="w-12 h-12 bg-white/50 border border-primary/20 rounded-2xl items-center justify-center shadow-sm"
                >
                    <Ionicons name="sync" size={20} color="#059669" />
                </TouchableOpacity>
            </View>

            <ScrollView
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#059669" />}
                className="flex-1"
                contentContainerStyle={{ padding: 24, paddingBottom: 100 + insets.bottom }}
                showsVerticalScrollIndicator={false}
            >
                {/* Balance Card - Glassmorphism */}
                <View className="bg-white/40 border border-white/60 p-8 mb-8 rounded-[32px] shadow-sm backdrop-blur-md overflow-hidden">
                    <View className="absolute -top-10 -right-10 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />

                    <View className="flex-row justify-between items-center mb-6">
                        <View className="bg-primary/10 px-3 py-1.5 rounded-full border border-primary/10">
                            <Text className="text-[10px] font-black text-primary uppercase tracking-widest">Settlement_Balance</Text>
                        </View>
                        <MaterialCommunityIcons name="finance" size={20} color="#059669" />
                    </View>

                    <View className="flex-row items-baseline">
                        <Text className="text-xs font-black text-muted-foreground uppercase mr-2 tracking-widest">GHS</Text>
                        <Text className="text-6xl font-black text-foreground tracking-tighter italic tabular-nums">
                            {wallet?.balance?.toFixed(2) || '0.00'}<Text className="text-primary">_</Text>
                        </Text>
                    </View>

                    <View className="mt-10 pt-6 border-t border-primary/10 flex-row items-center">
                        <View className="bg-primary/10 p-1.5 rounded-lg mr-3">
                            <Ionicons name="shield-checkmark" size={16} color="#059669" />
                        </View>
                        <Text className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex-1">
                            {wallet?.linked_solana_address ? `Vault Instance: ${wallet.linked_solana_address.slice(0, 12)}...` : 'Identity_Verification_Pending_Sync'}
                        </Text>
                    </View>
                </View>

                {/* Actions Grid */}
                <View className="flex-row gap-4 mb-10">
                    <TouchableOpacity
                        className="flex-1 bg-primary p-6 items-center justify-center rounded-3xl shadow-lg active:opacity-90 overflow-hidden min-h-[140px]"
                        onPress={() => setDepositModalVisible(true)}
                    >
                        <View className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full -mr-8 -mt-8" />
                        <Ionicons name="add" size={28} color="#FFF" />
                        <Text className="text-[10px] font-black text-white uppercase mt-2 tracking-widest">Deposit</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        className="flex-1 bg-white/40 border border-white/60 p-6 items-center justify-center rounded-3xl shadow-sm backdrop-blur-md active:bg-white/60 min-h-[140px]"
                        onPress={() => setWithdrawModalVisible(true)}
                    >
                        <Ionicons name="exit-outline" size={28} color="#059669" />
                        <Text className="text-[10px] font-black text-primary uppercase mt-2 tracking-widest">Withdraw</Text>
                    </TouchableOpacity>
                </View>

                {/* Transactions Header */}
                <View className="flex-row justify-between items-center mb-6 px-2">
                    <View className="flex-row items-center">
                        <View className="w-1 h-4 bg-primary rounded-full mr-3" />
                        <Text className="text-[11px] font-black text-foreground uppercase tracking-[0.2em]">Digital Ledger</Text>
                    </View>
                    <View className="bg-primary/5 px-2 py-1 rounded-md">
                        <Text className="text-[8px] font-bold text-primary italic uppercase tracking-widest">Real-time sync</Text>
                    </View>
                </View>

                <FlatList
                    data={transactions}
                    keyExtractor={(item) => item.id}
                    scrollEnabled={false}
                    renderItem={({ item }) => {
                        const isCredit = item.type === 'deposit' || item.type === 'earning' || item.type === 'refund';
                        return (
                            <View className="bg-white/40 border border-white/60 p-5 mb-4 rounded-3xl flex-row items-center shadow-sm">
                                <View className={`w-12 h-12 rounded-2xl items-center justify-center ${isCredit ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                                    <Ionicons
                                        name={isCredit ? "trending-up" : "trending-down"}
                                        size={20}
                                        color={isCredit ? "#10B981" : "#EF4444"}
                                    />
                                </View>
                                <View className="flex-1 ml-4 mr-2">
                                    <Text className="text-[11px] font-black text-foreground uppercase tracking-tight" numberOfLines={1}>
                                        {item.description || item.type}
                                    </Text>
                                    <Text className="text-[9px] font-bold text-muted-foreground uppercase mt-1">
                                        {new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </Text>
                                </View>
                                <View className="items-end">
                                    <Text className={`font-black text-base tabular-nums italic ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {isCredit ? '+' : '-'} {item.amount.toFixed(2)}
                                    </Text>
                                    <Text className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest mt-1">GHS</Text>
                                </View>
                            </View>
                        );
                    }}
                    ListEmptyComponent={
                        <View className="py-16 items-center justify-center bg-white/20 border border-dashed border-primary/20 rounded-[32px]">
                            <View className="w-16 h-16 bg-primary/5 rounded-full items-center justify-center mb-4">
                                <Ionicons name="receipt-outline" size={32} color="#059669" opacity={0.3} />
                            </View>
                            <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em]">Ledger_Instance_Empty</Text>
                        </View>
                    }
                />
            </ScrollView>


            {/* Deposit Modal */}
            <Modal
                visible={depositModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setDepositModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Deposit Funds</Text>
                            <TouchableOpacity onPress={() => setDepositModalVisible(false)} className="p-3 -mr-3">
                                <Ionicons name="close" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.modalSubtitle}>Enter amount to deposit via Paystack (Card/Mobile Money)</Text>

                        <TextInput
                            style={styles.input}
                            placeholder="Amount (GHS)"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={handleDeposit}
                            disabled={processing}
                        >
                            {processing ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.modalButtonText}>Iniate Payment</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Withdraw Modal */}
            <Modal
                visible={withdrawModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setWithdrawModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Withdraw Funds</Text>
                            <TouchableOpacity onPress={() => setWithdrawModalVisible(false)} className="p-3 -mr-3">
                                <Ionicons name="close" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>
                        <Text style={styles.modalSubtitle}>Withdraw to Mobile Money</Text>

                        <TextInput
                            style={styles.input}
                            placeholder="Amount (GHS)"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        <TextInput
                            style={styles.input}
                            placeholder="Phone Number (e.g. 0541234567)"
                            keyboardType="phone-pad"
                            value={phone}
                            onChangeText={setPhone}
                        />

                        <View style={styles.networkSelector}>
                            {['MTN', 'VOD', 'AIR'].map(net => (
                                <TouchableOpacity
                                    key={net}
                                    style={[styles.netOption, network === net && styles.netOptionSelected]}
                                    onPress={() => setNetwork(net)}
                                >
                                    <Text style={[styles.netText, network === net && styles.netTextSelected]}>{net}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={handleWithdraw}
                            disabled={processing}
                        >
                            {processing ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.modalButtonText}>Withdraw Now</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 60,
        paddingBottom: 16,
        paddingHorizontal: 20,
        backgroundColor: '#FFF',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '900',
        color: '#111827',
    },
    scrollContent: {
        padding: 20,
    },
    balanceCard: {
        backgroundColor: '#2563EB',
        borderRadius: 20,
        padding: 24,
        marginBottom: 24,
        shadowColor: '#2563EB',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    balanceLabel: {
        color: '#BFDBFE',
        fontSize: 14,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    balanceAmount: {
        color: '#FFFFFF',
        fontSize: 36,
        fontWeight: '900',
    },
    balanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginTop: 20,
    },
    cryptoBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 8,
    },
    cryptoText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: 'bold',
        fontFamily: 'monospace',
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    actionBtn: {
        alignItems: 'center',
        flex: 1,
    },
    actionIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    actionLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4B5563',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 16,
    },
    txCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    txIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    bgGreen: { backgroundColor: '#D1FAE5' },
    bgRed: { backgroundColor: '#FEE2E2' },
    txContent: {
        flex: 1,
    },
    txDesc: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 2,
    },
    txDate: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    txAmount: {
        fontSize: 14,
        fontWeight: 'bold',
    },
    textGreen: { color: '#059669' },
    textRed: { color: '#DC2626' },
    emptyContainer: {
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        color: '#9CA3AF',
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 40,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 24,
    },
    input: {
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        marginBottom: 16,
    },
    networkSelector: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 24,
    },
    netOption: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        alignItems: 'center',
    },
    netOptionSelected: {
        borderColor: '#2563EB',
        backgroundColor: '#EFF6FF',
    },
    netText: {
        fontWeight: 'bold',
        color: '#4B5563',
    },
    netTextSelected: {
        color: '#2563EB',
    },
    modalButton: {
        backgroundColor: '#2563EB',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    modalButtonText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
