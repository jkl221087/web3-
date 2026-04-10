// 合約版本
pragma solidity <=0.8.35;

//接口
interface testUsdt 
{    function balancesOf(address _user) external view returns (uint256);
}

//合約
contract contractName_who {
    uint256 public aaa = 1999;
}

//繼承
contract contractName_test is contractName_who {
    uint256 public bbb = 2000;
}

contract Owner{
    address public owner;
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }
}


//類型
contract contractName_tes is Owner {
    uint256 public bbb = 2000;
    string public ccc = "hello world";
    int public ddd = -100;
    bool public eee = true;
    uint256 public max = type(uint256).max;


//結構
    struct NftInfo{
        string name;//NFT名稱
        uint256 att; //攻擊力
        bool state; //狀態
    }
    NftInfo[] arms; //NFT陣列


    struct UserInfo{
        string name; //使用者名稱
        uint256 age; //使用者年齡
    }
    mapping(address => UserInfo) public userInfo; //使用者陣列
    mapping(address => uint256) public userAges; //使用者年齡陣列

    constructor(uint256 _setbbb) {
        owner = msg.sender; //合約擁有者
        bbb = _setbbb;
    }
    //構造函數
    //function
    function setOwner(address _user) public onlyOwner returns (bool) {
        owner = _user;
        return true;
    }
}

//修飾符
//private, public, internal, external
