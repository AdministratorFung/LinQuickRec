cmake_minimum_required(VERSION 3.14)

add_library(mock_datasystem STATIC
    mock_datasystem.cpp)

target_compile_features(mock_datasystem PRIVATE cxx_std_17)

target_include_directories(mock_datasystem PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
