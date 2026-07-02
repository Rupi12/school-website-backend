import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export const StatusSelector = ({ options, selected, onSelect, style }) => (
  <View style={[styles.statusSelectorContainer, style]}>
    {options.map(option => (
      <TouchableOpacity
        key={option}
        style={[
          styles.statusSelectorButton,
          selected === option && styles.statusSelectorButtonSelected,
        ]}
        onPress={() => onSelect(option)}
      >
        <Text style={[styles.statusSelectorText, selected === option && styles.statusSelectorTextSelected]}>
          {option}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

const styles = StyleSheet.create({
  statusSelectorContainer: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', overflow: 'hidden', marginBottom: 10 },
  statusSelectorButton: { flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: 'white' },
  statusSelectorButtonSelected: { backgroundColor: '#3b82f6' },
  statusSelectorText: { color: '#4b5563', fontWeight: '600' },
  statusSelectorTextSelected: { color: 'white' },
});