#ifndef STATS_EXPANDED_DATA_H
#define STATS_EXPANDED_DATA_H

#include "Utilities/DataMap.h"

class FloatData : public DataMap::Base
{
public:
    float value;
    explicit FloatData(float v) : value(v) {}
};

class BoolData : public DataMap::Base
{
public:
    bool value;
    explicit BoolData(bool v = false) : value(v) {}
};

// Stores an unsigned integer (e.g. a spell ID or a getMSTime() timestamp) -
// used for lightweight per-player dedup/throttle windows that don't require
// tracking any object's lifetime (safer than storing a raw pointer to
// something like a Spell instance, which can be reentrant/short-lived).
class UInt32Data : public DataMap::Base
{
public:
    uint32_t value;
    explicit UInt32Data(uint32_t v = 0) : value(v) {}
};

#endif
