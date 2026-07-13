cmake_minimum_required(VERSION 3.14)

add_library(mock_datasystem SHARED
    mock_datasystem.cpp)

target_compile_features(mock_datasystem PRIVATE cxx_std_17)

target_include_directories(mock_datasystem PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

set_target_properties(mock_datasystem PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
