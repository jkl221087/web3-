pragma solidity <=0.8.35;

contract testUsdt {
    mapping(address => uint256) public balances;

    function balancesOf(address _user) public view returns (uint256) {
        return balances[_user];
    }

    function setbalancesOf(address _user, uint256 _amount) public{
        balances[_user] = _amount;
    }
}