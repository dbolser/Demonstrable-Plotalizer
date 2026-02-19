import { describe, it, expect } from 'vitest';
import { detectColumnGroups } from '../utils/groupUtils';

describe('detectColumnGroups', () => {
  describe('token extraction', () => {
    it('should extract alphabetic tokens from column names', () => {
      const columnNames = ['n_snps_mac1', 'n_genes_mac1', 'other_column'];
      const groups = detectColumnGroups(columnNames);
      
      // Should extract tokens: 'n', 'snps', 'mac', 'genes', 'other', 'column'
      // Only 'n' and 'mac' appear in >=2 columns and <100%
      expect(groups.has('n')).toBe(true);
      expect(groups.has('mac')).toBe(true);
    });

    it('should handle mixed case tokens', () => {
      const columnNames = ['Snp_Count', 'snp_Data', 'gene_Count'];
      const groups = detectColumnGroups(columnNames);
      
      // 'snp' and 'count' tokens should be case-insensitive
      expect(groups.has('snp')).toBe(true);
      expect(groups.has('count')).toBe(true);
    });

    it('should extract multiple tokens from a single column name', () => {
      const columnNames = ['abc_def_ghi', 'abc_jkl', 'def_mno'];
      const groups = detectColumnGroups(columnNames);
      
      // 'abc' appears in 2 columns, 'def' appears in 2 columns
      expect(groups.has('abc')).toBe(true);
      expect(groups.has('def')).toBe(true);
      expect(groups.get('abc')?.length).toBe(2);
      expect(groups.get('def')?.length).toBe(2);
    });

    it('should handle columns with no alphabetic characters', () => {
      const columnNames = ['123', '456', '789'];
      const groups = detectColumnGroups(columnNames);
      
      expect(groups.size).toBe(0);
    });

    it('should handle columns with numeric separators', () => {
      const columnNames = ['gene1score', 'gene2score', 'gene3data'];
      const groups = detectColumnGroups(columnNames);
      
      // Numeric separators split tokens, so 'gene' and 'score' are separate
      // 'gene' appears in all 3 columns (100%), so it's excluded
      // 'score' appears in 2 out of 3 columns
      expect(groups.has('score')).toBe(true);
      expect(groups.get('score')?.length).toBe(2);
      // 'data' appears in only 1 column, so it's excluded
      expect(groups.has('data')).toBe(false);
    });

    it('should handle empty column names array', () => {
      const columnNames: string[] = [];
      const groups = detectColumnGroups(columnNames);
      
      expect(groups.size).toBe(0);
    });

    it('should handle single column', () => {
      const columnNames = ['single_column'];
      const groups = detectColumnGroups(columnNames);
      
      // No groups should be detected (need >=2 columns)
      expect(groups.size).toBe(0);
    });
  });

  describe('>=2 and <100% filter', () => {
    it('should exclude tokens appearing in only 1 column', () => {
      const columnNames = ['unique_token', 'shared_a', 'shared_b'];
      const groups = detectColumnGroups(columnNames);
      
      // 'unique' appears in only 1 column, should be excluded
      expect(groups.has('unique')).toBe(false);
      // 'shared' appears in 2 columns, should be included
      expect(groups.has('shared')).toBe(true);
    });

    it('should exclude tokens appearing in 100% of columns', () => {
      const columnNames = ['common_a', 'common_b', 'common_c'];
      const groups = detectColumnGroups(columnNames);
      
      // 'common' appears in all 3 columns (100%), should be excluded
      expect(groups.has('common')).toBe(false);
    });

    it('should include tokens appearing in exactly 2 columns', () => {
      const columnNames = ['a_x', 'b_x', 'c_y'];
      const groups = detectColumnGroups(columnNames);
      
      // 'x' appears in exactly 2 columns, should be included
      expect(groups.has('x')).toBe(true);
      expect(groups.get('x')?.length).toBe(2);
    });

    it('should include tokens appearing in n-1 columns (where n > 2)', () => {
      const columnNames = ['a_shared', 'b_shared', 'c_shared', 'd_unique'];
      const groups = detectColumnGroups(columnNames);
      
      // 'shared' appears in 3 out of 4 columns (75%), should be included
      expect(groups.has('shared')).toBe(true);
      expect(groups.get('shared')?.length).toBe(3);
    });

    it('should handle edge case with two columns', () => {
      const columnNames = ['same_a', 'same_b'];
      const groups = detectColumnGroups(columnNames);
      
      // 'same' appears in 2 out of 2 columns (100%), should be excluded
      expect(groups.has('same')).toBe(false);
    });

    it('should correctly filter with multiple token frequencies', () => {
      const columnNames = [
        'all_snp_1',     // all(3), snp(3)
        'all_snp_2',     // all(3), snp(3)
        'all_gene_3',    // all(3), gene(1)
      ];
      const groups = detectColumnGroups(columnNames);
      
      // 'all' appears in 100%, should be excluded
      expect(groups.has('all')).toBe(false);
      // 'snp' appears in 2 out of 3 (66%), should be included
      expect(groups.has('snp')).toBe(true);
      // 'gene' appears in 1 column, should be excluded
      expect(groups.has('gene')).toBe(false);
    });
  });

  describe('descending-size sort order', () => {
    it('should sort groups by descending size', () => {
      const columnNames = [
        'large_a',       // large(4)
        'large_b',       // large(4)
        'large_c',       // large(4)
        'large_medium',  // large(4), medium(3)
        'medium_x',      // medium(3)
        'medium_y',      // medium(3)
        'small_1',       // small(2)
        'small_2',       // small(2)
        'unique',        // unique(1)
      ];
      const groups = detectColumnGroups(columnNames);
      
      const entries = Array.from(groups.entries());
      
      // First group should be 'large' with 4 columns
      expect(entries[0][0]).toBe('large');
      expect(entries[0][1].length).toBe(4);
      
      // Second group should be 'medium' with 3 columns
      expect(entries[1][0]).toBe('medium');
      expect(entries[1][1].length).toBe(3);
      
      // Third group should be 'small' with 2 columns
      expect(entries[2][0]).toBe('small');
      expect(entries[2][1].length).toBe(2);
      
      // Verify descending order
      for (let i = 0; i < entries.length - 1; i++) {
        expect(entries[i][1].length).toBeGreaterThanOrEqual(entries[i + 1][1].length);
      }
    });

    it('should maintain stable order for groups with same size', () => {
      const columnNames = [
        'aaa_1', 'aaa_2',  // aaa(2)
        'zzz_3', 'zzz_4',  // zzz(2)
        'mmm_5', 'mmm_6',  // mmm(2)
      ];
      const groups = detectColumnGroups(columnNames);
      
      const entries = Array.from(groups.entries());
      
      // All groups should have size 2
      expect(entries[0][1].length).toBe(2);
      expect(entries[1][1].length).toBe(2);
      expect(entries[2][1].length).toBe(2);
      
      // Verify all three tokens are present
      const tokens = entries.map(e => e[0]);
      expect(tokens).toContain('aaa');
      expect(tokens).toContain('zzz');
      expect(tokens).toContain('mmm');
    });

    it('should sort correctly with many different group sizes', () => {
      const columnNames = [
        'one_1', 'one_2', 'one_3', 'one_4', 'one_5',  // one(5)
        'two_a', 'two_b', 'two_c', 'two_d',            // two(4)
        'three_x', 'three_y', 'three_z',               // three(3)
        'four_m', 'four_n',                            // four(2)
        'unique_p',                                     // unique(1) - excluded
      ];
      const groups = detectColumnGroups(columnNames);
      
      const sizes = Array.from(groups.values()).map(cols => cols.length);
      
      // Should be in descending order: [5, 4, 3, 2]
      expect(sizes).toEqual([5, 4, 3, 2]);
    });
  });

  describe('integration scenarios', () => {
    it('should handle realistic genomics column names', () => {
      const columnNames = [
        'n_snps_mac1',
        'n_snps_mac2',
        'n_genes_mac1',
        'n_genes_mac2',
        'total_count',
      ];
      const groups = detectColumnGroups(columnNames);
      
      // 'n' appears in 4 out of 5 columns (80%)
      expect(groups.has('n')).toBe(true);
      expect(groups.get('n')?.length).toBe(4);
      
      // 'mac' appears in 4 out of 5 columns (80%)
      expect(groups.has('mac')).toBe(true);
      
      // 'snps' and 'genes' each appear in 2 columns
      expect(groups.has('snps')).toBe(true);
      expect(groups.has('genes')).toBe(true);
    });

    it('should correctly identify column name components in dataset', () => {
      const columnNames = [
        'population_A_freq',
        'population_B_freq',
        'population_C_freq',
        'sample_A_count',
        'sample_B_count',
      ];
      const groups = detectColumnGroups(columnNames);
      
      // 'population' appears in 3/5, 'freq' appears in 3/5
      expect(groups.has('population')).toBe(true);
      expect(groups.get('population')?.length).toBe(3);
      expect(groups.has('freq')).toBe(true);
      expect(groups.get('freq')?.length).toBe(3);
      
      // 'sample' appears in 2/5, 'count' appears in 2/5
      expect(groups.has('sample')).toBe(true);
      expect(groups.has('count')).toBe(true);
    });

    it('should return groups with correct column names', () => {
      const columnNames = ['test_a', 'test_b', 'other_c'];
      const groups = detectColumnGroups(columnNames);
      
      const testGroup = groups.get('test');
      expect(testGroup).toBeDefined();
      expect(testGroup).toContain('test_a');
      expect(testGroup).toContain('test_b');
      expect(testGroup).not.toContain('other_c');
    });
  });
});
