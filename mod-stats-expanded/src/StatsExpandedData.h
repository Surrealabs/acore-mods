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

#endif
