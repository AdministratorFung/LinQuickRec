// RankSub 服务单元测试
// 测试 parse_skus_from_string、simulate_score 纯逻辑函数

#include "rank_sub_server.h"

#include <algorithm>
#include <cassert>
#include <iostream>
#include <string>
#include <vector>

using namespace rank;

// ============================================================================
// parse_skus_from_string 测试
// ============================================================================

void test_parse_skus_empty() {
    auto result = parse_skus_from_string("");
    assert(result.empty());
    std::cout << "[PASS] parse_skus_from_string: empty string" << std::endl;
}

void test_parse_skus_normal() {
    std::string input = "000001000123999999";
    auto result = parse_skus_from_string(input);
    assert(result.size() == 3);
    assert(result[0] == 1);
    assert(result[1] == 123);
    assert(result[2] == 999999);
    std::cout << "[PASS] parse_skus_from_string: normal 3 SKUs" << std::endl;
}

void test_parse_skus_partial_trailing() {
    std::string input = "00000100012399999912";
    auto result = parse_skus_from_string(input);
    assert(result.size() == 3);
    std::cout << "[PASS] parse_skus_from_string: trailing partial ignored" << std::endl;
}

void test_parse_skus_short_string() {
    std::string input = "12345";
    auto result = parse_skus_from_string(input);
    assert(result.empty());
    std::cout << "[PASS] parse_skus_from_string: string shorter than 6 returns empty" << std::endl;
}

void test_parse_skus_many() {
    std::string input;
    for (int i = 0; i < 500; ++i) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%06d", i);
        input += buf;
    }
    auto result = parse_skus_from_string(input);
    assert(result.size() == 500);
    assert(result[0] == 0);
    assert(result[499] == 499);
    std::cout << "[PASS] parse_skus_from_string: 500 SKUs" << std::endl;
}

void test_parse_skus_large_sku_id() {
    std::string input = "1000000000000000000";
    auto result = parse_skus_from_string(input);
    assert(result.size() == 1);
    assert(result[0] == 1000000000000000000ULL);
    std::cout << "[PASS] parse_skus_from_string: large SKU ID (1e18)" << std::endl;
}

// ============================================================================
// simulate_score 测试
// ============================================================================

void test_simulate_score_deterministic() {
    double score1 = simulate_score(12345, "test_user_feat");
    double score2 = simulate_score(12345, "test_user_feat");
    assert(score1 == score2);
    std::cout << "[PASS] simulate_score: deterministic for same inputs" << std::endl;
}

void test_simulate_score_range() {
    for (uint64_t sku = 0; sku < 1000; ++sku) {
        double score = simulate_score(sku, "some_feature_data");
        assert(score >= 0.0 && score < 100.0);
    }
    std::cout << "[PASS] simulate_score: all scores in [0, 100) for 1000 SKUs" << std::endl;
}

void test_simulate_score_different_sku() {
    double score1 = simulate_score(100, "user_feat");
    double score2 = simulate_score(200, "user_feat");
    assert(score1 != score2);
    std::cout << "[PASS] simulate_score: different SKU gives different score" << std::endl;
}

void test_simulate_score_different_user_feat() {
    double score1 = simulate_score(100, "user_A");
    double score2 = simulate_score(100, "user_B");
    assert(score1 != score2);
    std::cout << "[PASS] simulate_score: different user_feat gives different score" << std::endl;
}

void test_simulate_score_various_feats() {
    simulate_score(1, "");
    simulate_score(1, "a");
    simulate_score(1, std::string(10000, 'x'));
    std::cout << "[PASS] simulate_score: handles various user_feat sizes" << std::endl;
}

void test_simulate_score_zero_sku() {
    double score = simulate_score(0, "test_feat");
    assert(score >= 0.0 && score < 100.0);
    std::cout << "[PASS] simulate_score: SKU ID 0 handled correctly" << std::endl;
}

void test_simulate_score_large_user_feat() {
    std::string large_feat(10 * 1024 * 1024, 'z');
    double score = simulate_score(999, large_feat);
    assert(score >= 0.0 && score < 100.0);
    std::cout << "[PASS] simulate_score: handles 10MB user_feat" << std::endl;
}

void test_simulate_score_sorting_consistency() {
    std::vector<uint64_t> sku_ids = {999, 1, 100000, 42, 8888};
    std::string feat = "sorting_test_feat";

    std::vector<double> scores_first;
    for (uint64_t sku : sku_ids) {
        scores_first.push_back(simulate_score(sku, feat));
    }

    std::vector<double> scores_second;
    for (uint64_t sku : sku_ids) {
        scores_second.push_back(simulate_score(sku, feat));
    }

    assert(scores_first == scores_second);

    std::vector<std::pair<uint64_t, double>> pairs;
    for (size_t i = 0; i < sku_ids.size(); ++i) {
        pairs.emplace_back(sku_ids[i], scores_first[i]);
    }
    std::vector<std::pair<uint64_t, double>> sorted = pairs;
    std::sort(sorted.begin(), sorted.end(),
              [](const auto& a, const auto& b) { return a.second > b.second; });

    std::vector<double> scores_third;
    for (const auto& p : sorted) {
        scores_third.push_back(simulate_score(p.first, feat));
    }
    assert(sorted[0].second == scores_third[0]);

    std::cout << "[PASS] simulate_score: sorting consistency verified" << std::endl;
}

// ============================================================================
// main
// ============================================================================

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();

    std::cout << "=== RankSub Service Unit Tests ===" << std::endl;

    test_parse_skus_empty();
    test_parse_skus_normal();
    test_parse_skus_partial_trailing();
    test_parse_skus_short_string();
    test_parse_skus_many();
    test_parse_skus_large_sku_id();

    test_simulate_score_deterministic();
    test_simulate_score_range();
    test_simulate_score_different_sku();
    test_simulate_score_different_user_feat();
    test_simulate_score_various_feats();
    test_simulate_score_zero_sku();
    test_simulate_score_large_user_feat();
    test_simulate_score_sorting_consistency();

    std::cout << "\n=== All RankSub Tests Passed ===" << std::endl;
    return 0;
}
